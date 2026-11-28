"""Build a bounded, public digest from the existing financing publication inputs."""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit
from zoneinfo import ZoneInfo
import csv
import json
import os
import re
import shutil
import unicodedata

ASSETS = ('investor-evidence.js', 'investor-judgments.js', 'investor-evidence.css')
PUBLIC_FILE = 'investor-evidence.json'
BASIS_FILE = 'investor-evidence-basis.json'
SCOPE_DAYS = 30
MAX_ITEMS = 180
SHANGHAI = ZoneInfo('Asia/Shanghai')
TYPES = {
    'disclosure': ('新增融资披露', '可用于核实融资轮次、金额和直接出资方。', '以原公告核对披露口径和实际交割条件。'),
    'historical': ('历史资料补充', '可补足既有交易时间线。', '核对历史交易与当前问题采用的时间范围。'),
    'source': ('补充证据', '为同一笔交易提供补查出处，来源独立性仍需核实。', '比较各出处引用的原文和金额口径。'),
    'correction': ('资料更正', '如果原判断依赖更正字段，需要重新核对。', '对照更正前后和支持更正的原件。'),
    'conflict': ('证据冲突待核', '来源间存在差异，依赖该字段的判断仍待证。', '优先查发行人或直接资方的原始披露。'),
    'review': ('档案字段待复核', '快照字段发生变化，事实及原因仍需核实。', '对照原件，确认是资料更正、口径调整还是实质进展。'),
    'text': ('文字性修正', '展示文字有调整，已比对字段的含义未见变化。', '如研究引用了原文，可再次核对措辞。'),
}
FIELD_LABELS = {'company_name':'公司主体', 'date':'日期', 'date_kind':'日期口径', 'round':'轮次 / 类型',
                'amount':'金额', 'valuation':'估值', 'country':'注册地区', 'investors_json':'投资方',
                'primary_sector':'原赛道标签', 'secondary_sector':'原细分标签'}
DISCLOSURE = re.compile(r'^(?:原始|首次)?(?:公开|公司|媒体|机构|投中网|官方|发行人)?(?:公告披露|披露|公告|新闻|报道|发布)(?:日(?:期)?|时间)?(?:[（(，,；;。]|$)')
EVENT = re.compile(r'^(?:完成|实际|首次|末次|最终|工商|交易|股份|资金|认购|增资|发行|交割|股权|产权|首个|上市|缴款|协议|港交所|挂牌|变更|付款|出资|股东会|决议)')
EVENT_PREFACE = re.compile(r'^(?:发行人|公司|招股书|招股说明书|发行文件)披露(?:的)?')
CV = re.compile(r'/(?:flash/|news/\d+-)(\d{4})(\d{2})(\d{2})-\d+\.html$')
TRACKING = {'spm', 'from', 'fbclid', 'gclid', 'wxfrom', 'wx_header'}


def identity(kind, value):
    return sha256((kind+value).encode()).hexdigest()[:24]


def parse_day(value):
    try:
        return date.fromisoformat(value).isoformat() if isinstance(value, str) and len(value) == 10 else None
    except ValueError:
        return None


def precision(value):
    return parse_day(value) or (value if isinstance(value, str) and len(value) == 7 and parse_day(value+'-01') else None)


def local_day(stamp):
    return datetime.fromisoformat(stamp).astimezone(SHANGHAI).date().isoformat()


def link_parts(url):
    try:
        parts = urlsplit(url)
        return parts if parts.scheme in {'https', 'http'} and parts.hostname and not parts.username and not parts.password else None
    except (ValueError, AttributeError, TypeError):
        return None


def public_id(url):
    return url.rpartition('=')[2] if '=' in url else ''


def publisher(url):
    return link_parts(url).hostname.removeprefix('www.')


def source_id(url):
    parts = link_parts(url)
    query = sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
                   if k.casefold() not in TRACKING and not k.casefold().startswith('utm_'))
    return publisher(url), parts.path, urlencode(query)


def reference_id(url):
    return source_id(url), link_parts(url).fragment


def unique_urls(urls):
    result = {}
    for url in urls:
        if link_parts(url):
            result.setdefault(reference_id(url), url)
    return list(result.values())


def dated_cv_url(url):
    if publisher(url) != 'chinaventure.com.cn':
        return None
    match = CV.fullmatch(link_parts(url).path)
    return parse_day('-'.join(match.groups())) if match else None


def evidence_dates(deal):
    stamp, kind = precision(deal.get('day')), deal.get('dateKind') or ''
    if DISCLOSURE.match(kind):
        return None, stamp
    event_kind = EVENT_PREFACE.sub('', kind)
    if EVENT.match(event_kind) and not re.search(r'原档|估计|约|待核|报道', kind):
        return stamp, None
    return None, None


def record_state(deal):
    # Identity fields and values come from the same public record clients open.
    return {
        'company_name': deal.get('company') or '',
        'date': deal.get('day') or '',
        'date_kind': deal.get('dateKind') or '',
        'round': deal.get('stage') or '',
        'amount': deal.get('amount') or '',
        'valuation': deal.get('valuation') or '',
        'country': deal.get('country') or '',
        'investors_json': sorted(p[0] for p in deal.get('parties', [])),
        'urls': unique_urls(deal.get('sources', [])),
    }


def display(value):
    return '、'.join(value) if isinstance(value, list) else value


def comparable_text(value):
    return ''.join(unicodedata.normalize('NFKC', display(value)).split())


def differences(before, after):
    return [
        {'field': label, 'before': display(before[k]), 'after': display(after[k])}
        for k, label in FIELD_LABELS.items()
        if k in before and k in after and before[k] != after[k]
    ]


def source_details(urls, *, evidence_urls=(), prior_sources=(), conflict=False, dated=()):
    sources = {}
    old = {source_id(url) for url in unique_urls(prior_sources)}
    old_references = {reference_id(url) for url in unique_urls(prior_sources)}
    old_publishers = {identity[0] for identity in old}
    introduced = {reference_id(url) for url in unique_urls(evidence_urls)}
    all_urls = unique_urls([*evidence_urls, *urls])
    for item in dated:
        if link_parts(item.get('url')) and (day := parse_day(item.get('published_on') or item.get('publishedOn'))):
            sources[source_id(item['url'])] = day
    result = []
    for url in all_urls:
        key = source_id(url)
        relation = '出处'
        reference = reference_id(url)
        if reference in introduced:
            if conflict:
                relation = '待核出处'
            elif old:
                if reference in old_references:
                    relation = '原有出处'
                elif key in old:
                    relation = '同份资料补充定位'
                else:
                    relation = '同站补充' if key[0] in old_publishers else '补充出处，独立性待核'
            elif any(source_id(entry['url'])[0] == key[0] for entry in result):
                relation = '同站出处'
        elif old:
            relation = '原有出处'
        elif any(source_id(entry['url'])[0] == key[0] for entry in result):
            relation = '同站出处'
        result.append({'url':url, 'publishedOn':sources.get(key) or dated_cv_url(url), 'relation':relation})
    return result[:12]


def evidence_snapshot(deals, *, now, ledger_through=None, historical=None, corrections=None,
                      receipts=None, dots_through=None, cv_checked_at=None, dots_scan_at=None,
                      prior=None, basis=None):
    today = date.fromisoformat(local_day(now))
    since = (today - timedelta(days=SCOPE_DAYS)).isoformat()
    historical, corrections, receipts = historical or {}, corrections or {}, receipts or {}
    prior, basis = prior or {}, basis or {}
    prior_items = {item['id']:item for item in prior.get('items', [])}
    old_states = basis.get('states', {})
    old_corrections = basis.get('corrections', {})
    previous_from = basis.get('from')
    # Compare the same bounded public-record window. Explicit receipts/reviews add older rows.
    coverage = {
        'through': max(filter(None, (ledger_through, dots_through)), default=None),
        'from': since,
        'scope': '最近 30 天的已发布融资档案、已核历史批次与有回执的补查',
        'ledgerThrough': ledger_through,
        'dotsThrough': dots_through,
        'previousSnapshotAt': basis.get('observedAt'),
        'snapshotAt': now,
        'snapshotDay': today.isoformat(),
        'ledgerCheck': {
            'status':'checked' if cv_checked_at else 'unchanged' if ledger_through else 'unavailable',
            'at':cv_checked_at or basis.get('cvCheckedAt'),
        },
        'dotsCheck': {
            'status':'checked' if dots_scan_at else 'unchanged' if dots_through else 'unavailable',
            'at':max(filter(None, (dots_scan_at, basis.get('dotsScanAt'))), default=None),
        },
        'notes': '按已发布融资档案和现有回执汇总。历史批次日、来源发布日期、档案观察日与实际入库或更正时间分别记录。',
    }
    if not basis:
        coverage['notes'] += ' 当前为首次快照，跨次补源与字段变化仅在有专门审核或回执时列出。'
    states, items, verified = {}, [], {}
    historical_through = None
    for deal in deals:
        key = deal['key']
        event_date, disclosure_date = evidence_dates(deal)
        old_item = prior_items.get(key, {})
        receipt = receipts.get(key)
        reviewed = corrections.get(key)
        historical_day = historical.get(key)
        latest_archive = precision(deal.get('day')) or ''
        in_window = latest_archive >= since and latest_archive[:10] <= today.isoformat()
        if not (in_window or historical_day or reviewed or receipt or key in old_states or old_item):
            continue
        if historical_day and historical_day >= since:
            historical_through = max(historical_through or historical_day, historical_day)
        current = record_state(deal)
        if not current['urls']:
            continue
        if in_window or historical_day or reviewed or receipt or old_item:
            states[key] = current
        old = old_states.get(key)
        changed = differences(old, current) if old else []
        old_urls = old['urls'] if old else []
        old_source_ids = {reference_id(url) for url in old_urls}
        new_urls = [url for url in current['urls'] if reference_id(url) not in old_source_ids]
        latest_history = historical_day and historical_day >= since
        current_known_disclosure = disclosure_date and disclosure_date >= since
        stamp = receipt.get('recordedAt') if receipt else None
        first_seen = (stamp if receipt and receipt['kind'] == 'disclosure' else old_item.get('firstSeenAt'))
        dated = [*old_item.get('sources', []), *(receipt.get('sources', []) if receipt else [])]
        selected, extra = [], []
        if reviewed:
            verified[key] = identity('correction', json.dumps(reviewed, ensure_ascii=False, sort_keys=True))
        if reviewed and old_corrections.get(key) != verified[key]:
            kind, changed = ('correction', reviewed['differences'])
            selected = reviewed['sources']
            extra = reviewed['extraInstitutions']
        elif receipt and receipt['kind'] == 'conflict':
            kind = 'conflict'
            changed = [{'field':'金额', 'before': current['amount'], 'after': receipt['reportedAmount']}]
            selected = [s['url'] for s in receipt['sources']]
            old_urls = current['urls']
        elif changed:
            kind = 'text' if all(comparable_text(item['before']) == comparable_text(item['after']) for item in changed) else 'review'
            selected = new_urls if old_urls else []
        elif receipt and receipt['kind'] in {'disclosure', 'source'}:
            kind = receipt['kind']
            selected = [s['url'] for s in receipt['sources']]
            if kind == 'source' and not old_urls:
                identities = {reference_id(u) for u in unique_urls(selected)}
                old_urls = [u for u in current['urls'] if reference_id(u) not in identities]
            if kind == 'disclosure':
                disclosure_date = parse_day(receipt.get('announcedOn')) or disclosure_date
        elif old and new_urls:
            kind, selected = 'source', new_urls
        elif old_item and (old_item.get('changeDate') or '') >= since:
            items.append(old_item)
            continue
        elif latest_history and not old:
            kind = 'historical'
        elif current_known_disclosure and not old and (not previous_from or disclosure_date >= previous_from):
            kind = 'disclosure'
        else:
            continue
        label, impact, action = TYPES[kind]
        if kind == 'historical':
            change_date = historical_day
        elif kind == 'disclosure' and disclosure_date:
            change_date = disclosure_date
        elif kind == 'correction' and not old:
            # The applied manifest verifies fields. The first build can only date this observation.
            change_date = today.isoformat()
        else:
            change_date = local_day(stamp or now)
        ids = {public_id(link) for _, link in deal.get('parties', [])} | set(extra)
        amount = ((' · '+current['amount']) if current['amount'] else '')
        detail = (' · '+current['round']+amount) if kind in {'disclosure', 'historical'} and current['round'] else ''
        sources = source_details(current['urls'], evidence_urls=selected, prior_sources=old_urls,
                                 conflict=kind == 'conflict', dated=dated)
        signal_key = json.dumps([key,kind,change_date,changed,[s['url'] for s in sources]], ensure_ascii=False)
        items.append({
            'id':key, 'signalId':identity('evidence', signal_key), 'kind':kind, 'label':label, 'title':deal['company']+' · '+label+detail,
            'href':deal['href'], 'companyId':public_id(deal['companyHref']), 'companyName':deal['company'],
            'institutionIds':sorted(ids - {''}), 'sectorIds':list(filter(None, [deal.get('sectorId'),deal.get('subId'),*deal.get('sectorBranches',[])])),
            'eventDate':event_date, 'disclosureDate':disclosure_date, 'dateKind':deal.get('dateKind'),
            'firstSeenAt':first_seen, 'correctedAt':None, 'changeDate':change_date, 'sources':sources,
            'differences':changed, 'impact':impact, 'nextAction':action,
        })
    coverage['historicalBatchThrough'] = historical_through
    # Preserve distinct correction and source findings when a busy backfill fills the buffer.
    limit = dict(disclosure=65, historical=32, source=25, correction=28, conflict=10, review=15, text=5)
    retained = []
    for item in sorted(items, key=lambda item: (item['changeDate'], item['id']), reverse=True):
        kind = item['kind']
        if limit[kind]:
            retained.append(item)
            limit[kind] -= 1
    if len(retained) < len(items):
        coverage['notes'] += ' 共整理 '+str(len(items))+' 笔关联档案，按变动类型保留最近 '+str(len(retained))+' 笔。'
    # The file is public-only. Never pass store exports or browser input to the builder.
    return {'version':1, 'coverage':coverage, 'items':retained[:MAX_ITEMS]}, {
        'version':1, 'from':since, 'observedAt':now, 'states':states, 'dotsThrough':dots_through,
        'corrections':verified, 'cvCheckedAt':coverage['ledgerCheck']['at'], 'dotsScanAt':coverage['dotsCheck']['at'],
    }


def safe_json(path, expected):
    if not path or not Path(path).is_file():
        return expected
    try:
        result = json.loads(Path(path).read_text())
        return result if isinstance(result, type(expected)) else expected
    except (OSError, ValueError):
        return expected


def historical_batches(directory, since):
    events = {}
    for path in sorted(directory.glob('????-??-??-*.csv')):
        batch_day = parse_day(path.name[:10])
        if not batch_day or batch_day < since:
            continue
        with path.open(encoding='utf-8-sig', newline='') as file:
            for row in csv.DictReader(file):
                if event_id := row.get('event_id'):
                    events.setdefault(identity('event', event_id), batch_day)
    return events


def investors(value):
    return [item['name'] for item in json.loads(value or '[]') if item.get('name')]


def correction_fields(label, correction):
    if 'corrected' in correction:
        before, after = correction['expected'], correction['corrected']
    elif label == 'country':
        before, after = ({'country':correction['expected_country']}, {'country':correction['country']})
    elif label == 'amount':
        before, after = ({'amount':correction['expected']}, {'amount':correction['amount']})
    else:
        expected = correction['expected']
        before, after = ({'investors_json':expected},
                         {'investors_json':[name for name in expected if name not in correction['remove']]})
    if 'investors_json' in before:
        before = before | {'investors_json':investors(before['investors_json']) if isinstance(before['investors_json'], str) else before['investors_json']}
    if 'investors_json' in after:
        after = after | {'investors_json':investors(after['investors_json']) if isinstance(after['investors_json'], str) else after['investors_json']}
    return before, after


def verified_corrections(directory, rows):
    applied = {}
    manifests = ('investor', 'amount', 'round', 'date', 'company', 'country')
    raw = {row['event_id']:row for row in rows}
    for label in manifests:
        reviewed = safe_json(directory / f'reviewed-{label}-corrections.json', [])
        for correction in reviewed:
            row = raw.get(correction['event_id'])
            if not row or correction['source'] not in json.loads(row.get('sources_json') or '[]'):
                continue
            before, after = correction_fields(label, correction)
            # Validate the raw published state, including its identity where the manifest requires it.
            if 'company_id' not in after and 'company_id' in correction and row['company_id'] not in {
                correction['company_id'], correction.get('final_company_id', correction['company_id'])
            }:
                continue
            if label in ('investor', 'amount', 'date') and correction.get('round') != row['round']:
                continue
            if label == 'amount' and correction.get('day') != row['date_key']:
                continue
            actual = {field:investors(row.get(field)) if field == 'investors_json' else row.get(field) for field in after}
            if actual != after:
                continue
            reviewed_investors = correction.get('corrected', {}).get('investors_json')
            if reviewed_investors and json.loads(reviewed_investors) != json.loads(row.get('investors_json') or '[]'):
                continue
            changes = differences(before, after)
            if not changes:
                continue
            sources = [correction['source'], *correction.get('additional_sources', [])]
            old_investors = set(before.get('investors_json', [])) - set(after.get('investors_json', []))
            event = applied.setdefault(identity('event', row['event_id']), {'differences':[], 'sources':[], 'extraInstitutions':[]})
            event['differences'].extend(item for item in changes if item not in event['differences'])
            event['sources'].extend(url for url in sources if url in json.loads(row.get('sources_json') or '[]'))
            event['extraInstitutions'].extend(identity('institution', name) for name in sorted(old_investors))
    return applied


def dots_receipts(batches):
    events = {}
    scanned_at = None
    for batch in batches:
        scan = batch.get('scanned_at', '')
        if parse_day(scan[:10]):
            scanned_at = max(scanned_at or scan, scan)
        for row in batch['candidates']:
            status = row['status']
            if status == 'held' and row.get('reason') == 'reported_amount_disagrees' and row.get('related_event_id'):
                event_id, kind = row['related_event_id'], 'conflict'
            elif status in {'added', 'source_added'}:
                event_id, kind = row['event_id'], 'disclosure' if status == 'added' else 'source'
            else:
                continue
            evidence = row.get('evidence_sources') or [{'url':url} for url in row.get('sources', [])]
            key = identity('event', event_id)
            metadata = {'kind':kind, 'recordedAt':row.get('recorded_at'), 'announcedOn':row.get('announced_on'),
                        'sources':evidence, 'reportedAmount':row.get('reported_amount')}
            if key in events:
                existing = events[key]
                if existing['kind'] == 'conflict':
                    continue
                if kind != 'conflict':
                    existing['sources'].extend(evidence)
                    continue
            events[key] = metadata
    return events, scanned_at


def copy_assets(out):
    for asset in ASSETS:
        shutil.copyfile(asset, out / asset)


def publish(out, deals, *, rows=()):
    copy_assets(out)
    records = out / 'records'
    records.mkdir(exist_ok=True)
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    since = (date.fromisoformat(local_day(now)) - timedelta(days=SCOPE_DAYS)).isoformat()
    directory = Path('historical-financing')
    ledger = safe_json(Path('ledger.json'), {})
    prior = safe_json(os.environ.get('INVESTOR_PRIOR_EVIDENCE') or records / PUBLIC_FILE, {})
    basis = safe_json(os.environ.get('INVESTOR_PRIOR_BASIS') or records / BASIS_FILE, {})
    if (prior.get('version') != 1 or not isinstance(prior.get('coverage'), dict)
            or not isinstance(prior.get('items'), list)
            or not all(isinstance(item, dict) and isinstance(item.get('id'), str) for item in prior['items'])):
        prior = {}
    if (basis.get('version') != 1 or not isinstance(basis.get('states'), dict)
            or not all(isinstance(state, dict) and isinstance(state.get('urls'), list) for state in basis['states'].values())
            or (prior and prior['coverage'].get('snapshotAt') != basis.get('observedAt'))):
        basis = {}
    receipts, dots_scan_at = dots_receipts(safe_json(os.environ.get('INVESTOR_DOTS_RECEIPT'), []))
    dots_day = max(filter(None, [(dots_scan_at or '')[:10], basis.get('dotsThrough')]), default=None)
    asset, next_basis = evidence_snapshot(deals, now=now, ledger_through=parse_day(ledger.get('through')),
                                          historical=historical_batches(directory, since),
                                          corrections=verified_corrections(directory, rows), receipts=receipts,
                                          dots_through=dots_day, cv_checked_at=os.environ.get('INVESTOR_CV_CHECKED_AT'),
                                          dots_scan_at=dots_scan_at, prior=prior, basis=basis)
    for name, payload in ((PUBLIC_FILE, asset), (BASIS_FILE, next_basis)):
        (records / name).write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
