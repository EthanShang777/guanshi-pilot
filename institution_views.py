from collections import Counter, defaultdict
from pathlib import Path
from hashlib import sha256
import json
import re
import shutil
import subprocess


TYPES = ['创投与股权投资机构', '产业资本与企业投资方', '政府引导基金与政策性平台', '金融机构及投资平台', '待识别主体']
from institution_identity import REVIEWED_ALIASES
from sector_taxonomy import BRANCHES

TYPES += ['具体基金']
EXCLUDED_STAGES = {'股权转让', '介绍上市', '拟增资'}


def category(name, managers, row):
    if any(f['fundId'] == row['id'] for f in row.get('fundDisclosures', [])):
        return 5
    if re.search(r'(?:基金|创业投资|股权投资)(?:合伙企业|中心)\s*[（(]有限合伙[）)]$', name):
        return 5
    if any(f['managerId'] == row['id'] for f in row.get('fundDisclosures', [])):
        return 0
    if re.search('政府投资引导|产业引导基金|政府引导|政府投资基金', name):
        return 2
    if name in REVIEWED_ALIASES or name in managers or re.search(r'创业投资|创投|风险投资|私募股权|股权投资管理|\bventures?\b|\bprivate equity\b', name, re.I):
        return 0
    if re.search('银行$|证券$|保险公司$|保险股份有限公司$', name):
        return 3
    if name in {'小米集团', '腾讯', '美的集团', '三七互娱', '阿里巴巴', '百度', '联想集团'} or '产业投资部' in name:
        return 1
    return 4


def publish(out):
    records = out / 'records'
    managers = json.loads(Path('institution-fund-managers.json').read_text())
    brands = {v['brand'] for v in managers.values()}
    shards = {path: json.loads(path.read_text()) for path in sorted(records.glob('institution-??.json'))}
    rows = {key: row for shard in shards.values() for key, row in shard.items()
            if not (row.get('redirect') or row.get('evidenceOnly'))}
    # ICU provides Chinese transliteration on the Ubuntu publication runner.
    names = [row['name'] for row in rows.values()]
    roman = subprocess.run(['uconv', '-x', 'Han-Latin; Latin-ASCII; Upper'], input='\n'.join(n.replace('\n', ' ') for n in names),
                           text=True, capture_output=True, check=True).stdout.split('\n')
    assert len(names) == len(roman)
    active_names = set(names)
    index = []
    directions = defaultdict(set)
    scope_codes = {}
    for (key, row), spelling in zip(rows.items(), roman):
        name = row['name']
        events = row['events']
        cases = [e for e in events if e[3] not in EXCLUDED_STAGES]
        companies = {e[7]:e for e in reversed(cases)}
        sectors = Counter(e[5] for e in companies.values() if e[5] and e[5]!='待归类')
        reviewed = REVIEWED_ALIASES.get(name, {})
        aliases = set(row.get('aliases', ())) | (set(reviewed.get('aliases', ())) - active_names)
        for fund in row.get('fundDisclosures', []):
            if fund['fundId'] == key:
                source = fund['source']
                aliases.update(source.get('aliases', []))
                if current_name := source.get('currentRegisteredName'):
                    aliases.add(current_name)
        initial = re.search('[A-Z0-9]', spelling)
        letter = initial[0] if initial and initial[0].isalpha() else '#'
        filters = sorted({(e[5], e[6] or '', tuple(e[8])) for e in cases})
        for sector, sub, branches in filters:
            directions[sector]
            if sub:
                directions[sector].add(sub)
            directions[sector].update(BRANCHES[branch] for branch in branches)
        label = category(name, brands, row | {'id': key})
        aliases = sorted(aliases - {name})
        row['directoryType'] = TYPES[label]
        row['aliases'] = aliases
        row['aliasSource'] = reviewed.get('source', '')
        codes = [scope_codes.setdefault(scope, len(scope_codes)) for scope in filters]
        index.append([name,key,label,letter,aliases,len(companies),'、'.join(s for s,_ in sectors.most_common(2)),codes])
    for path, shard in shards.items():
        path.write_text(json.dumps(shard, ensure_ascii=False, separators=(',', ':')))
    index.sort(key=lambda r:(r[2],r[3],r[0]))
    (records/'institution-directory.json').write_text(json.dumps({'types':TYPES,'rows':index,
        'scopePaths': list(scope_codes),
        'directions':{sector: sorted(values) for sector, values in directions.items()}},ensure_ascii=False,separators=(',',':')))
    for asset in ('institution-views.js','institution-views.css'):
        shutil.copyfile(asset,out/asset)
    revision = sha256(Path('institution-views.js').read_bytes()).hexdigest()[:12]
    for filename, mode in [('institutions.html','directory'),('institution.html','profile')]:
        path=out/filename
        html=path.read_text()
        default=re.search('data-default="([^"]*)"',html)
        body='<main id="inst-app" data-mode="'+mode+'" data-default="'+(default[1] if default else '')+'"><p>正在读取机构资料…</p></main>'
        html=re.sub(r'<main\b.*?</main>',lambda _: body,html,count=1,flags=re.S)
        html=html.replace('<script src="within-page.js"></script>', '')
        html=re.sub(r'<link rel="stylesheet" href="institution-views.css">|<script src="sector-filter.js[^"]*"></script>|<script defer src="institution-views.js[^"]*"></script>', '', html)
        html=html.replace('</html>','<link rel="stylesheet" href="institution-views.css"><script src="sector-filter.js?v=1"></script><script defer src="institution-views.js?v='+revision+'"></script></html>')
        path.write_text(html)
