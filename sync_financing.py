"""Apply daily disclosures or a reviewed historical batch to the D1 master."""
import argparse
import csv
import json
import re
import unicodedata
from datetime import date
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit
from d1 import FIELDS, database, query

GENERIC_ROUNDS = {'', '未知', '未披露', '未公布', '未公开', '融资', '新一轮',
                  '新一轮融资', '股权融资', '首轮融资'}
SPECIFIC_ROUND = re.compile(r'(?:PRE-?)?(?:[A-H]\d*(?:\+{1,4}|-\d+)?|IPO)|(?:天使|种子)\+{0,4}|战略')

def packed(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'))

def normalize(value):
    return ''.join(unicodedata.normalize('NFKC', value or '').casefold().split())

def names(row):
    return {name for field in ('company_name', 'raw_company_key')
            for value in re.split(r'[;；]', row[field] or '') if (name := normalize(value))}

def company_relation(incoming, existing):
    incoming_names, existing_names = names(incoming), names(existing)
    same_name = bool(incoming_names & existing_names)
    left_id, right_id = incoming['company_id'], existing['company_id']
    if left_id and left_id == right_id:
        return 'same'
    if same_name:
        return 'conflict' if left_id and right_id else 'same'
    if any(min(len(a), len(b)) >= 2 and (a in b or b in a)
           for a in incoming_names for b in existing_names):
        return 'conflict' if left_id and right_id else 'similar'
    return 'different'

def round_key(value):
    key = normalize(value).upper().removeprefix('SERIES').replace('PRE-', 'PRE').removesuffix('轮')
    if key == '战略融资':
        return '战略'
    return '' if key in GENERIC_ROUNDS else key

def investor_names(row):
    return {normalize(i.get('name') if isinstance(i, dict) else i)
            for i in json.loads(row['investors_json'] or '[]') if isinstance(i, (str, dict))} - {''}

def match_status(incoming, existing, reviewed_ids):
    relation = company_relation(incoming, existing)
    if relation == 'different':
        return 'different'
    stage = round_key(incoming['round'])
    old_stage = round_key(existing['round'])
    shared_source = bool(set(json.loads(incoming['sources_json'])) &
                         set(json.loads(existing['sources_json'] or '[]')))
    shared_investor = bool(investor_names(incoming) & investor_names(existing))
    if stage != old_stage and SPECIFIC_ROUND.fullmatch(stage) and SPECIFIC_ROUND.fullmatch(old_stage):
        # A reviewed batch can explicitly establish that a report contains multiple rounds.
        if relation == 'same' and shared_source and existing['event_id'] in reviewed_ids:
            return 'different'
        if not shared_source and not shared_investor:
            return 'different'
        return 'uncertain'
    if stage and stage == old_stage and relation != 'conflict':
        if shared_investor or (relation == 'same' and shared_source and incoming['date_key'] == existing['date_key']):
            return 'match'
    return 'uncertain'

def append_sources(db, event_id, urls):
    # Merge against the current row in SQL so a retry or another source update cannot lose URLs.
    updated = query(db, '''UPDATE financing_events SET sources_json=(
            SELECT json_group_array(url) FROM (
                SELECT value AS url FROM json_each(financing_events.sources_json)
                UNION ALL
                SELECT proposed.value FROM json_each(?) AS proposed
                WHERE NOT EXISTS (SELECT 1 FROM json_each(financing_events.sources_json)
                                  WHERE value=proposed.value)
            ))
            WHERE event_id=? AND EXISTS(
                SELECT value FROM json_each(?) EXCEPT SELECT value FROM json_each(sources_json)
            ) RETURNING event_id''', [urls, event_id, urls])
    return len(updated)

def sync_rows(db, rows, *, reviewed=False):
    reviewed_ids = {row['event_id'] for row in rows} if reviewed else set()
    columns = ','.join(FIELDS)
    insert = ('INSERT INTO financing_events (' + columns + ') VALUES (' +
              ','.join('?' for _ in FIELDS) + ') ON CONFLICT(event_id) DO NOTHING RETURNING event_id')
    additions = linked = held = 0
    for row in rows:
        event_id = row['event_id']
        existing = query(db, 'SELECT * FROM financing_events WHERE event_id=?', [event_id])
        if not existing:
            candidates = query(db, '''SELECT event_id, company_id, company_name, raw_company_key,
                    date_key, round, investors_json, sources_json FROM financing_events
                    WHERE date_key BETWEEN date(?,'-14 days') AND date(?,'+14 days')''',
                               [row['date_key'], row['date_key']])
            possible = [(status, candidate) for candidate in candidates
                        if (status := match_status(row, candidate, reviewed_ids)) != 'different']
            if not possible:
                if query(db, insert, [row[field] for field in FIELDS]):
                    additions += 1
                    continue
                existing = query(db, 'SELECT * FROM financing_events WHERE event_id=?', [event_id])
            elif len(possible) == 1 and possible[0][0] == 'match':
                linked += append_sources(db, possible[0][1]['event_id'], row['sources_json'])
                continue
        if existing:
            current = existing[0]
            stages = {round_key(row['round']), round_key(current['round'])} - {''}
            if len(stages) <= 1 and company_relation(row, current) not in ('different', 'conflict'):
                linked += append_sources(db, event_id, row['sources_json'])
                continue
        held += 1
        print('Possible existing transaction, preserved for reconciliation:', event_id)
    total = query(db, 'SELECT COUNT(*) AS total FROM financing_events')[0]['total']
    print(f'D1 master rows={total}')
    print(f'D1 additions={additions} source_updates={linked} possible_duplicates={held}')
    return additions, linked, held

def daily_row(event):
    sector = event.get('sector') or '待归类'
    investors = [{'name': n, 'role': None, 'amount': None} for n in event['investors']]
    urls = list(dict.fromkeys(event['sources']))
    if not urls:
        raise ValueError('Missing disclosure URL')
    return dict(date=event['day'], company_name=event['company'], primary_sector=sector,
                secondary_sector='', round=event['round'], investors_json=packed(investors),
                amount=event.get('amount_display', ''), valuation='', date_kind='投中网报道日期',
                sources_json=packed(urls), event_id='cv:flash:'+event['id'], company_id='',
                raw_company_key=event['company'], date_key=event['day'], sector=sector,
                sector_source='投中网快讯分类')

def read_history(path):
    with path.open(encoding='utf-8-sig', newline='') as file:
        reader = csv.DictReader(file)
        if reader.fieldnames != FIELDS:
            raise ValueError('Expected financing master CSV columns')
        rows = list(reader)
    if not rows or len({row['event_id'] for row in rows}) != len(rows):
        raise ValueError('Expected unique event IDs in a nonempty historical batch')
    for row in rows:
        try:
            if set(row) != set(FIELDS) or any(value is None for value in row.values()):
                raise ValueError('Malformed CSV row')
            if not all(row[field].strip() for field in ('event_id', 'company_id', 'company_name')):
                raise ValueError('Missing event or company identity')
            if date.fromisoformat(row['date_key']).isoformat() != row['date_key']:
                raise ValueError('Expected an ISO date key')
            urls = json.loads(row['sources_json'])
            if not isinstance(urls, list) or not urls or not all(
                    isinstance(url, str) and urlsplit(url).scheme in ('https', 'http')
                    and urlsplit(url).hostname for url in urls):
                raise ValueError('Missing public disclosure URL')
            investors = json.loads(row['investors_json'])
            if not isinstance(investors, list) or not all(isinstance(item, dict) and
                    isinstance(item.get('name'), str) and item['name'].strip() for item in investors):
                raise ValueError('Invalid investor data')
            row['sources_json'] = packed(list(dict.fromkeys(urls)))
        except ValueError as error:
            raise ValueError(f"Historical record {row['event_id']}: {error}") from error
    return rows


def sync_investor_corrections(db, corrections):
    applied = already_applied = held = 0
    for correction in corrections:
        expected = correction['expected']
        remove = set(correction['remove'])
        if not remove or len(expected) != len(set(expected)) or not remove.issubset(expected):
            raise ValueError('Expected a unique set of investors and a nonempty subset to remove')
        remaining = [name for name in expected if name not in remove]
        identity = [correction['event_id'], correction['company_id'], correction['round'], correction['source']]
        guard = '''event_id=? AND company_id=? AND round=?
                   AND EXISTS (SELECT 1 FROM json_each(sources_json) WHERE value=?)'''
        rows = query(db, 'SELECT investors_json FROM financing_events WHERE ' + guard, identity)
        if rows:
            current = rows[0]['investors_json']
            investors = json.loads(current)
            names = [investor['name'] for investor in investors]
            if names == remaining:
                already_applied += 1
                continue
            if names == expected:
                updated = packed([investor for investor in investors if investor['name'] not in remove])
                if query(db, 'UPDATE financing_events SET investors_json=? WHERE ' + guard +
                         ' AND investors_json=? RETURNING event_id', [updated, *identity, current]):
                    applied += 1
                    continue
        held += 1
        print('Reviewed investor correction held:', correction['event_id'])
    print(f'D1 investor corrections applied={applied} already_applied={already_applied} held={held}')
    return applied, already_applied, held


def sync_history_queue(db, directory):
    batches = sorted(directory.glob('*.csv'))
    if not batches:
        return
    query(db, '''CREATE TABLE IF NOT EXISTS historical_financing_batches (
                 digest TEXT PRIMARY KEY, filename TEXT NOT NULL, rows_added INTEGER NOT NULL,
                 sources_linked INTEGER NOT NULL, rows_held INTEGER NOT NULL,
                 processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)''')
    completed = {row['digest'] for row in query(db, 'SELECT digest FROM historical_financing_batches')}
    for path in batches:
        digest = sha256(path.read_bytes()).hexdigest()
        if digest in completed:
            continue
        print('Historical financing batch:', path.name, flush=True)
        additions, linked, held = sync_rows(db, read_history(path), reviewed=True)
        query(db, '''INSERT INTO historical_financing_batches
                     (digest, filename, rows_added, sources_linked, rows_held) VALUES (?,?,?,?,?)''',
              [digest, path.name, additions, linked, held])
        completed.add(digest)

def sync(events):
    rows = [daily_row(event) for event in events]
    db=database()
    if 'country' not in {c['name'] for c in query(db,'PRAGMA table_info(financing_events)')}:
        query(db,"ALTER TABLE financing_events ADD COLUMN country TEXT NOT NULL DEFAULT ''")
    # Registry identifiers establish jurisdiction; exchange listings alone do not.
    registries={'cn_uscc':'中国','jp_corporate_number':'日本','gb_companies_house':'英国',
                'fr_siren':'法国','sg_uen':'新加坡','se_orgnr':'瑞典','se_org_number':'瑞典',
                'fi_business_id':'芬兰','be_kbo':'比利时'}
    cases=' '.join('WHEN company_id GLOB ? THEN ?' for _ in registries)
    params=[v for registry,country in registries.items() for v in ('co:'+registry+':*',country)]
    query(db,"UPDATE financing_events SET country=CASE "+cases+" ELSE country END WHERE country='' AND ("+
          ' OR '.join('company_id GLOB ?' for _ in registries)+')',params+params[::2])
    locations=json.loads(Path('country-locations.json').read_text())
    for key,place in locations.items():
        if key.startswith('cv:flash:'):
            query(db,"UPDATE financing_events SET country=? WHERE event_id=? AND country=''",[place[0],key])
    query(db,'CREATE INDEX IF NOT EXISTS financing_by_date ON financing_events(date_key)')
    return sync_rows(db, rows)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('previous_ledger', type=Path, nargs='?')
    historical = parser.add_mutually_exclusive_group()
    historical.add_argument('--historical-csv', type=Path, help='Apply a reviewed incremental CSV')
    historical.add_argument('--historical-dir', type=Path, help='Apply unprocessed reviewed CSV batches')
    args = parser.parse_args()
    if args.historical_csv or args.historical_dir:
        if args.previous_ledger:
            parser.error('Pass either a previous ledger or historical financing batches')
        if args.historical_csv:
            rows = read_history(args.historical_csv)
            sync_rows(database(), rows, reviewed=True)
        else:
            db = database()
            sync_history_queue(db, args.historical_dir)
            corrections = args.historical_dir / 'reviewed-investor-corrections.json'
            if corrections.is_file():
                sync_investor_corrections(db, json.loads(corrections.read_text()))
        return
    current=json.loads(Path('ledger.json').read_text())['events']
    old={e['id']:e for e in json.loads(args.previous_ledger.read_text())['events']} if args.previous_ledger else {}
    sync([e for e in current if old.get(e['id'])!=e])

if __name__=='__main__':
    main()
