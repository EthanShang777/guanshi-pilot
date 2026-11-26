"""Canonical fund evidence and review state in the financing master database."""
from collections import defaultdict
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit
import json

SEED = Path('institution-fund-lps.json')
FIELDS = ('record_id', 'kind', 'fund_id', 'subject_id', 'as_of', 'source', 'payload')
BASES = ('认购金额', '实际出资', '转让对价')

def token(value):
    return sha256(value.encode()).hexdigest()[:24]

def https(url):
    parsed = urlsplit(url)
    return parsed.scheme == 'https' and bool(parsed.hostname)

def contribution(value, sources):
    if not isinstance(value, dict):
        return None
    amount = value.get('amountFen')
    if type(amount) is not int or not 0 < amount < 2**53 or value.get('basis') not in BASES:
        return None
    if value.get('source') not in sources or not https(value['source']):
        return None
    return {key: value[key] for key in ('amountFen', 'basis', 'source')}

def fact(kind, fund_id, subject_id, as_of, source, payload):
    key = token('|'.join((kind, fund_id, subject_id, as_of, source)))
    return (key, kind, fund_id, subject_id, as_of, source,
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')))

def seed_facts(seed):
    records = []
    for fund in seed:
        fund_id = fund['fundId']
        as_of = fund['source']['date']
        url = fund['source']['url']
        if token('institution'+fund['fundName']) != fund_id or not https(url):
            raise ValueError('Fund seed requires an exact legal identity and HTTPS source')
        header = {key: fund[key] for key in ('fundId','fundName','managerId','managerName',
            'sizeCny','capitalBasis','otherLpCount','source')}
        if balance := fund.get('reportedBalance'):
            if not https(balance['source']) or not balance['asOf'] or balance['amountCny'] < 0:
                raise ValueError('Reported balance requires a date, non-negative amount, and source')
            header['reportedBalance'] = balance
        records.append(fact('fund', fund_id, fund['managerId'], as_of, url, header))
        for p in fund['partners']:
            identity = token('institution'+p['name'])
            records.append(fact('lp', fund_id, identity, as_of, url, p | {'public': True}))
        for s in fund.get('publishedStatistics', []):
            records.append(fact('stat', fund_id, fund_id, s['asOf'], s['source'], s))
        for a in fund.get('reviewedInvestments', []):
            records.append(fact('allocation', fund_id, a['eventId'], '', a['source'], a))
    if len({r[0] for r in records}) != len(records):
        raise ValueError('Duplicate fund evidence key in reviewed seed')
    return records

def ensure_schema(db, query):
    query(db, """CREATE TABLE IF NOT EXISTS fund_master_facts (
        record_id TEXT PRIMARY KEY, kind TEXT NOT NULL, fund_id TEXT NOT NULL,
        subject_id TEXT NOT NULL, as_of TEXT NOT NULL, source TEXT NOT NULL,
        payload TEXT NOT NULL CHECK(json_valid(payload)))""")
    query(db, """CREATE INDEX IF NOT EXISTS fund_master_by_fund
                ON fund_master_facts(fund_id, kind, as_of)""")
    query(db, """CREATE INDEX IF NOT EXISTS fund_master_by_subject
                ON fund_master_facts(subject_id, kind, fund_id)""")

def read_facts(db, query):
    rows = []
    last = ''
    while chunk := query(db, """SELECT * FROM fund_master_facts WHERE record_id>?
                                ORDER BY record_id LIMIT 500""", [last]):
        rows.extend(tuple(row[key] for key in FIELDS) for row in chunk)
        last = chunk[-1]['record_id']
    return rows

def save_facts(db, query, records, current):
    existing = {r[0]: r for r in current}
    changes = [r for r in records if existing.get(r[0]) != r]
    for start in range(0, len(changes), 12):
        chunk = changes[start:start+12]
        placeholders = ','.join(['(?,?,?,?,?,?,?)'] * len(chunk))
        writes = query(db, '''INSERT INTO fund_master_facts VALUES ''' + placeholders + '''
            ON CONFLICT(record_id) DO UPDATE SET payload=excluded.payload
            WHERE fund_master_facts.payload IS NOT excluded.payload RETURNING record_id''',
            [item for row in chunk for item in row])
        if len(writes) != len(chunk):
            raise ValueError('Fund master changed during import; retry against the latest copy')
    return len(changes)

def prepare_cloud(db, query):
    ensure_schema(db, query)
    prior = read_facts(db, query)
    records = seed_facts(json.loads(SEED.read_text()))
    changed = save_facts(db, query, records, prior)
    current = read_facts(db, query) if changed else prior
    saved = {row[0]: row for row in current}
    assert all(saved.get(row[0]) == row for row in records)
    print(f'Fund master verified {len(records)} imported evidence facts, {changed} writes')
    return current

def snapshot(rows):
    funds, allocations = {}, defaultdict(dict)
    partners, stats = defaultdict(list), defaultdict(list)
    for _, kind, fund_id, subject_id, as_of, url, payload in rows:
        p = json.loads(payload)
        if kind == 'fund':
            previous = funds.get(fund_id)
            if previous is None or (as_of, url) > (previous['source']['date'], previous['source']['url']):
                funds[fund_id] = p
        elif kind == 'lp' and p['public']:
            partners[(fund_id, as_of, url)].append(p)
        elif kind == 'stat':
            stats[fund_id].append(p)
        elif kind == 'allocation':
            key = (subject_id, fund_id)
            existing = allocations[subject_id].get(fund_id)
            if existing and existing != p:
                raise ValueError(f'Conflicting allocation evidence for {key}')
            allocations[subject_id][fund_id] = p
    return ([f | {'partners': [
        {k: p[k] for k in ('name','disclosedContributionCny','disclosedPercent','existingInstitution')}
        for p in sorted(partners[(i,f['source']['date'],f['source']['url'])],
                        key=lambda p: (
                            p['disclosedContributionCny'] is None,
                            -(p['disclosedContributionCny'] or 0), p['name']))],
        'publishedStatistics': sorted(stats[i],key=lambda value:value['asOf'],reverse=True)}
         for i,f in funds.items()], allocations)

def register_coverage(funds, institutions):
    output = {}
    for fund in funds:
        i = fund['fundId']
        items = institutions.get(i, {}).get('events', [])
        cases = []
        for deal in items:
            for p in deal.get('partyAllocations', []):
                if p['institutionId'] == i:
                    cases.append({k:deal[k] for k in ('key','company','day','href','stage')} |
                                 {k:p[k] for k in ('basis','amountFen','source')})
        indexed = {record['key'] for record in cases}
        totals = {basis: sum(x['amountFen'] for x in cases if x['basis'] == basis)
                  for basis in BASES}
        output[i] = dict(totalEvents=len(items), disclosedEvents=len(indexed), cases=cases,
            totalsFen=totals, missingEventIds=[d['key'] for d in items if d['key'] not in indexed],
            sizeStatus='已核验' if fund['sizeCny'] else '待核验',
            lpStatus='已核验公开披露' if fund['partners'] or fund['otherLpCount'] else '待核验',
            balanceStatus='已核验公开披露' if fund.get('reportedBalance') else '缺当前可投余额披露')
    return output

def coverage_facts(coverage):
    rows = []
    for fund_id, state in coverage.items():
        rows.append(fact('coverage', fund_id, fund_id, '', '', {k: v for k,v in state.items() if k != 'cases'}))
        for record in state['cases']:
            rows.append(fact('deal_link', fund_id, record['key'], '', '', record))
        for event_id in state['missingEventIds']:
            rows.append(fact('deal_link', fund_id, event_id, '', '', {'status':'缺本基金出资明细'}))
    return rows

def replace_derived(db, query, built, current):
    changed = save_facts(db, query, built, current)
    active = {r[0] for r in built}
    obsolete = [r[0] for r in current if r[1] in ('coverage','deal_link') and r[0] not in active]
    for start in range(0, len(obsolete), 80):
        ids = obsolete[start:start+80]
        query(db, "DELETE FROM fund_master_facts WHERE kind IN ('coverage','deal_link') AND record_id IN ("
              + ','.join('?' for _ in ids) + ')', ids)
    saved = {r[0]: r for r in read_facts(db, query) if r[1] in ('coverage','deal_link')}
    assert saved == {r[0]: r for r in built}
    return changed, len(obsolete)
