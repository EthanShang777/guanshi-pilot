"""Generate the public Pages artifact from the synchronized D1 financing master."""
from collections import defaultdict, Counter
from hashlib import sha256
from html import escape as esc
from pathlib import Path
from urllib.parse import urlencode, urlsplit
import json
import shutil

from reader import build_library
from update import filename, event_url, link

OUT = Path('public')
NAV = [('index.html','融资事件'),('companies.html','公司档案'),('institutions.html','机构档案'),
       ('reports.html','研究周报'),('landscape.html','赛道画布'),('changes.html','变化追踪')]
DECKS = {}
CSS = Path('site.css').read_text()
BAR = Path('index.html').read_text().split('<div id="local-find"',1)[1].split('</div>',1)[0]
BAR = '<div id="local-find"'+BAR+'</div>'

def dump(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')))

def token(value):
    return sha256(value.encode()).hexdigest()[:24]

def page(path,title,section,content,*,meta='',cover=False):
    nav=''.join('<a href="'+u+'"'+(' aria-current="location"' if label==section else '')+'>'+label+'</a>' for u,label in NAV)
    search=BAR if path not in ('landscape.html','companies.html') else ''
    if path not in ('landscape.html','companies.html','company.html') and 'class="arc-track"' not in content:
        component=DECKS.get(section,'')
        # A shared fragment for secondary pages keeps the publication compact.
        if component:content+='<div data-shelf="'+component+'"></div>'

    (OUT/path).write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>'+esc(title)+' · 观势</title><style>'+CSS+'</style><header class="top"><a class="brand" href="index.html">观势</a>'
        '<nav aria-label="栏目">'+nav+'</nav></header><main><header class="hero"><h1>'+esc(title)+'</h1>'+
        ('<p>'+esc(meta)+'</p>' if meta else '')+'</header>'+search+('<script src="company-history.js"></script>' if path in ('companies.html','company.html') else '')+content+'</main>'+
        ('<script src="within-page.js"></script>' if search else '')+('<script src="load-shelf.js"></script>' if 'data-shelf=' in content else '<script src="shelf.js"></script>')+'</html>')

def redirect(path,url):
    (OUT/path).write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url='+esc(url,quote=True)+'">'+link(url,'打开档案 →'))

def cloud_rows():
    from d1 import database,query
    db=database()
    total=query(db,'SELECT count(*) AS n FROM financing_events')[0]['n']
    last=''
    rows=[]
    while True:
        chunk=query(db,'SELECT * FROM financing_events WHERE event_id>? ORDER BY event_id LIMIT 1000',[last])
        if not chunk:break
        rows.extend(chunk);last=chunk[-1]['event_id']
    if not total or len(rows)!=total:raise ValueError('Incomplete cloud snapshot')
    return rows

def deck(section,counts):
    cards=[]; destinations=[]
    for sector,n in counts.most_common():
        url=sector_url(section,sector)
        cards.append('<div class="arc-slot"><button class="arc-card"><strong>'+esc(sector)+'</strong><b>'+str(n)+
                     {'公司档案':' 家公司','机构档案':' 家机构'}.get(section,' 笔融资')+'</b></button></div>')
        destinations.append('<article class="arc-record" hidden><h2>'+link(url,sector+' →')+'</h2></article>')
    return ('<section class="arc"><div class="arc-track" tabindex="0" aria-label="行业赛道">'+''.join(cards)+
            '</div><div class="arc-bottom"><div>'+''.join(destinations)+'</div><div class="arc-controls"><button aria-label="上一赛道">‹</button>'
            '<output></output><button aria-label="下一赛道">›</button></div></div></section>')

def sector_url(section,sector):
    if section=='融资事件':return filename('sector',sector)
    return filename('companies' if section=='公司档案' else 'institutions',sector)

def financing_table(rows, body_id=''):
    columns=('公司','地区 / 国家','公告日期','轮次 / 类型','融资金额','投资方','估值','所属赛道')
    return ('<div class="finance-scroll" tabindex="0" role="region" aria-label="融资事件表"><table class="finance-grid">'
            '<thead><tr>'+''.join('<th scope="col">'+name+'</th>' for name in columns)+'</tr></thead><tbody'+
            (' id="'+body_id+'"' if body_id else '')+'>'+rows+'</tbody></table></div>')

def list_pages(base,title,section,items,make_row,first=''):
    size=60
    def url(i):return base if i==0 else base[:-5]+'-'+str(i+1)+'.html'
    pages=max(1,(len(items)+size-1)//size)
    for i in range(pages):
        nav='<nav>'+ (link(url(i-1),'上一页') if i else '')+f'　{i+1} / {pages}　'+(link(url(i+1),'下一页') if i+1<pages else '')+'</nav>'
        rows=''.join(make_row(r) for r in items[i*size:(i+1)*size])
        body=(first if i==0 else '')+nav+(financing_table(rows) if section=='融资事件' else rows)+nav
        page(url(i),title,section,body)

def build(rows):
    OUT.mkdir(exist_ok=True)
    data=OUT/'records';data.mkdir(exist_ok=True)
    for asset in ('within-page.js','shelf.js','atlas.css','atlas.js','master-detail.js','master-search.js','load-shelf.js','company-browser.js','company-history.js'):
        shutil.copyfile(asset,OUT/asset)
    locations=json.loads(Path('country-locations.json').read_text())
    fund_managers=json.loads(Path('institution-fund-managers.json').read_text())
    live=json.loads(Path('ledger.json').read_text())['events']
    old_by_source={u:e for e in live for u in e['sources']}
    history=json.loads(Path('history-public.json').read_text())
    old_history=defaultdict(list)
    for h in history:old_history[h['source']].append(h)
    companies={}; institutions={}; deals=[]; legacy={}; refs=defaultdict(list)
    groups=defaultdict(list); buckets=defaultdict(dict); names=defaultdict(set)
    def entity(groups,kind,key,name):
        k=token(kind+key)
        return groups.setdefault(k,dict(key=k,name=name,href=kind+'.html?id='+k,events=[]))
    for row in sorted(rows,key=lambda r:(r['date_key'],r['event_id']),reverse=True):
        key=token('event'+row['event_id'])
        urls=[u for u in json.loads(row['sources_json'] or '[]') if isinstance(u,str) and urlsplit(u).scheme in ('http','https')]
        c=entity(companies,'company',row['company_id'] or row['event_id'],row['company_name'])
        country=row.get('country') or ''
        area,city=locations.get(row['company_id'] or row['event_id'],('',''))
        display=country
        if country=='中国' and area=='中国' and city:
            display=city
        elif country in ('中国香港','中国澳门','中国台湾'):
            display=country[2:]
        d=dict(key=key,href='deal.html?id='+key,company=row['company_name'],companyHref=c['href'],day=row['date'],
               sector=row['primary_sector'] or '待归类',sub=row['secondary_sector'],stage=row['round'],amount=row['amount'],
               country=country,location=display,valuation=row['valuation'],dateKind=row['date_kind'],sources=urls,investors=[],parties=[],aliases=[],reports=[])
        c['events'].append(d);names[d['company']].add(c['href'])
        deal_institutions = {}
        for item in json.loads(row['investors_json'] or '[]'):
            n=item.get('name') if isinstance(item,dict) else item
            if not n or n in d['investors']:continue
            inst=entity(institutions,'institution',n,n)
            deal_institutions[inst['key']] = inst
            d['investors'].append(n);d['parties'].append([n,inst['href']])
            if n in fund_managers:
                manager = fund_managers[n]['brand']
                brand = entity(institutions, 'institution', manager, manager)
                deal_institutions[brand['key']] = brand
        for institution in deal_institutions.values():
            institution['events'].append(d)
        for u in urls:
            if u in old_by_source:
                e=old_by_source[u];legacy[event_url(e)]=d['href'];legacy[filename('company',e['company'])]=c['href']
                if e['company']!=d['company'] and e['company'] not in d['aliases']:d['aliases'].append(e['company'])
            for h in old_history[u]:
                if h['company'] not in (d['company'],*d['aliases']) and h['company'] not in d['company']:continue
                legacy['historical-'+h['key']+'.html']=d['href']
                for rid in h.get('reports',[]):
                    if rid not in d['reports']:d['reports'].append(rid)
                if h.get('reports'):refs[h['company']].append(h)
        groups[d['sector']].append(d);deals.append(d)
        buckets['deal-'+key[:2]][key]=d
    for key,records in buckets.items():dump(data/(key+'.json'),records)
    def event_row(d):
        cells=[d['location'],d['day'],d['stage'],d['amount'],'、'.join(d['investors']),d['valuation'],' / '.join(filter(None,[d['sector'],d['sub']]))]
        return ('<tr><th scope="row">'+link(d['href'],d['company'])+'</th>'+
                ''.join('<td>'+esc(v or '未记录')+'</td>' for v in cells)+'</tr>')
    counts=Counter({s:len(items) for s,items in groups.items()})
    for section,stat,slug in [('融资事件',counts,'financing'),('公司档案',Counter({k:len({d['companyHref'] for d in v}) for k,v in groups.items()}),'company'),
                              ('机构档案',Counter({k:len({i for d in v for i in d['investors']}) for k,v in groups.items()}),'institution')]:
        DECKS[section]='records/shelf-'+slug+'.html'
        (OUT/DECKS[section]).write_text(deck(section,stat))
    import re
    for section,slug in [('研究周报','reports'),('变化追踪','changes')]:
        original=Path(slug+'.html').read_text()
        found=re.search(r'<section class="arc">.*?</section>',original,re.S)
        if found:
            DECKS[section]='records/shelf-'+slug+'.html'
            (OUT/DECKS[section]).write_text(found[0])
    list_pages('index.html','融资时间线','融资事件',deals,event_row,
        '<p class="search-entry">'+link('search.html',f'检索全部 {len(deals):,} 笔融资 →')+'</p>'+deck('融资事件',counts))
    for sector,items in groups.items():list_pages(filename('sector',sector),sector,'融资事件',items,event_row)
    for kind,entities,index,section in [('company',companies,'companies.html','公司档案'),('institution',institutions,'institutions.html','机构档案')]:
        by_sector=defaultdict(list);parts=defaultdict(dict)
        for k,entity_row in entities.items():
            items=entity_row['events']
            for sector in dict.fromkeys(d['sector'] for d in items):by_sector[sector].append(entity_row)
            parts[k[:2]][k]={'name':entity_row['name'],'events':[[d['href'],d['company'],d['day'],d['stage'],d['amount']] for d in items]}
            if kind=='company':
                parts[k[:2]][k].update(location=items[0]['location'],sector=items[0]['sub'] or items[0]['sector'],
                    events=[[d['href'],d['day'],d['stage'],d['amount'],d['parties'],d['sources']] for d in items])
            old=filename(kind,entity_row['name'])
            if Path(old).exists() and (kind=='institution' or len(names[entity_row['name']])==1):legacy[old]=entity_row['href']
        for prefix,part in parts.items():dump(data/(kind+'-'+prefix+'.json'),part)
        if kind=='company':
            from company_directory import build_directory
            build_directory(entities,by_sector,data,OUT,page,dump,link,redirect,sector_url)
            continue
        def entry(e):return '<div class="directory-row">'+link(e['href'],e['name'])+f'<small>{len(e["events"])} 笔融资</small></div>'
        directory=sorted(entities.values(),key=lambda e:(-len(e['events']),e['name']))
        list_pages(index,section,section,directory,entry,(link('research-companies.html','公司研究库与同行对照 →') if kind=='company' else '')+link('search.html','检索全部融资 →')+deck(section,Counter({s:len(v) for s,v in by_sector.items()})))
        for s,items in by_sector.items():list_pages(sector_url(section,s),s,section,items,entry)
    for kind,title,section in [('company','公司档案','公司档案'),('institution','机构档案','机构档案'),('deal','融资详情','融资事件')]:
        default=legacy.pop(kind+'.html','')
        page(kind+'.html',title,section,'<section id="record" data-kind="'+kind+'" data-default="'+esc(default)+'"></section><script defer src="master-detail.js"></script>')
    for path,url in legacy.items():redirect(path,url)
    for h in history:
        old='historical-'+h['key']+'.html'
        if old not in legacy:redirect(old,'search.html?'+urlencode({'company':h['company']}))
    research=json.loads(Path('research-index.json').read_text())
    for n in refs:
        page(filename('research-company',n),n,'公司档案',link('search.html?'+urlencode({'company':n}),'查看融资记录')+''.join(
            '<p>'+link('report-'+rid+'.html',research[rid]['title'])+'</p>' for rid in dict.fromkeys(r for h in refs[n] for r in h['reports'])))
    # The research library and atlas share the same publication directory.
    import atlas
    atlas.OUTPUT=OUT/'atlas'
    build_library(page,link,filename,research,refs,deals,[])
    by_year=defaultdict(list)
    for d in deals:by_year[d['day'][:4] or '未列明'].append([d[k] for k in ('key','company','aliases','day','sector','stage','amount','investors','valuation','sub','location')])
    for year,items in by_year.items():dump(data/('search-'+year+'.json'),items)
    manifest={'events':len(deals),'companies':len(companies),'institutions':len(institutions),'years':list(by_year),'sectors':list(groups)}
    dump(data/'manifest.json',manifest)
    shell=Path('search.html').read_text()
    form=shell.split('<form id="archive-form">',1)[1].split('</form>',1)[0]
    import re
    form=re.sub(r'(<select name="(sector|year)"><option value="">[^<]+</option>).*?</select>',r'\1</select>',form)
    page('search.html','融资交叉检索','融资事件','<form id="archive-form">'+form+'</form><p id="match-count" role="status"></p>'+financing_table('', 'matches')+'<nav><button id="prev">上一页</button><button id="next">下一页</button></nav><script defer src="master-search.js"></script>')
    for p in Path('.').glob('research-company-*.html'):
        if not (OUT/p.name).exists():
            title=re.search(r'<h1>(.*?)</h1>',p.read_text()).group(1)
            redirect(p.name,'search.html?'+urlencode({'company':title}))
    redirect('find.html','search.html')
    assert sum(len(v) for v in groups.values())==len(rows)==len({d['key'] for d in deals})
    print(manifest['events'], 'published events;',len(companies),'company groups;',len(institutions),'institution names')

if __name__=='__main__':build(cloud_rows())
