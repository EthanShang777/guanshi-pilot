from collections import Counter, defaultdict
from pathlib import Path
import json
import re
import shutil
import subprocess


TYPES = ['创投与股权投资机构', '产业资本与企业投资方', '政府引导基金与政策性平台', '金融机构及投资平台', '待识别主体']
BRANDS = {
    '深创投': ['深圳市创新投资集团有限公司', 'SCGC'],
    '达晨财智': ['深圳市达晨财智创业投资管理有限公司'],
    'IDG资本': ['IDG Capital'],
    '毅达资本': ['Addor Capital'],
    '红杉中国': ['HongShan'],
    '清流资本': ['Crystal Stream Capital'],
}


def category(name, managers):
    if re.search('政府投资引导|产业引导基金|政府引导|政府投资基金', name):
        return 2
    if name in BRANDS or name in managers or re.search(r'创业投资|创投|风险投资|私募股权|股权投资管理|\bventures?\b|\bprivate equity\b', name, re.I):
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
    aliases = {alias: brand for brand, names in BRANDS.items() for alias in names}
    groups = defaultdict(list)
    for path in records.glob('institution-??.json'):
        for key, row in json.loads(path.read_text()).items():
            raw = row['name']
            name = managers.get(raw, {}).get('brand', aliases.get(raw, raw))
            groups[name].append((key, row))
    # ICU provides Chinese transliteration on the Ubuntu publication runner.
    names = list(groups)
    roman = subprocess.run(['uconv', '-x', 'Han-Latin; Latin-ASCII; Upper'], input='\n'.join(n.replace('\n', ' ') for n in names),
                           text=True, capture_output=True, check=True).stdout.split('\n')
    assert len(names) == len(roman)
    index = []
    for name, spelling in zip(names, roman):
        members = groups[name]
        key = next((k for k,r in members if r['name'] == name), members[0][0])
        events = {}
        for _, row in members:
            events.update((e[0], e) for e in row['events'])
        companies = {e[7]:e for e in sorted(events.values(),key=lambda e:e[2] or '')}
        sectors = Counter(e[5] for e in companies.values() if e[5] and e[5]!='待归类')
        other = sorted(({r['name'] for _,r in members} | set(BRANDS.get(name, []))) - {name})
        initial = re.search('[A-Z0-9]', spelling)
        letter = initial[0] if initial and initial[0].isalpha() else '#'
        index.append([name,key,category(name,brands),letter,other,len(companies),'、'.join(s for s,_ in sectors.most_common(2))])
        if len(members)>1 or name!=members[0][1]['name']:
            extra = {'name':name,'events':sorted(events.values(),key=lambda e:e[2] or '',reverse=True),
                     'entities':[[r['name'],managers.get(r['name'],{}).get('source','')] for _,r in members]}
            (records/('portfolio-'+key+'.json')).write_text(json.dumps(extra,ensure_ascii=False))
        index[-1].append(len(members)>1 or name!=members[0][1]['name'])
    index.sort(key=lambda r:(r[2],r[3],r[0]))
    (records/'institution-directory.json').write_text(json.dumps({'types':TYPES,'rows':index},ensure_ascii=False,separators=(',',':')))
    for asset in ('institution-views.js','institution-views.css'):
        shutil.copyfile(asset,out/asset)
    for filename, mode in [('institutions.html','directory'),('institution.html','profile')]:
        path=out/filename
        html=path.read_text()
        default=re.search('data-default="([^"]*)"',html)
        body='<main id="inst-app" data-mode="'+mode+'" data-default="'+(default[1] if default else '')+'"><p>正在读取机构资料…</p></main>'
        html=re.sub(r'<main\b.*?</main>',lambda _: body,html,count=1,flags=re.S)
        html=html.replace('<script src="within-page.js"></script>', '')
        html=html.replace('</html>','<link rel="stylesheet" href="institution-views.css"><script defer src="institution-views.js"></script></html>')
        path.write_text(html)
