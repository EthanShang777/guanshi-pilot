"""Generate the public Pages artifact from the synchronized D1 financing master."""
from collections import defaultdict, Counter
from hashlib import sha256
from html import escape as esc
from itertools import chain
from pathlib import Path
from urllib.parse import urlencode, urlsplit
import json
import re
import shutil

from fa_publication import SCRIPTS as FA_SCRIPTS, publish_assets as publish_fa_assets, write_fund_index, write_search_indexes
from fund_master import contribution, coverage_facts, prepare_cloud, register_coverage, replace_derived, snapshot
from reader import build_library
from institution_identity import REVIEWED_ALIASES, participant
from sector_taxonomy import BRANCHES, classify_sector, has_fine_direction, public_filter
from update import filename, event_url, link

OUT = Path('public')
NAV = [('index.html','融资事件'),('companies.html','公司档案'),('institutions.html','机构档案'),
       ('reports.html','研究周报'),('landscape.html','赛道画布'),('changes.html','变化追踪'),
       ('projects.html','我的项目')]
DECKS = {}
OUT_OF_FINANCING = {'股权转让', '介绍上市', '拟增资'}
SECTOR_SCRIPT = '<script src="sector-filter.js?v=1"></script>'
CSS = Path('site.css').read_text()
BAR = Path('index.html').read_text().split('<div id="local-find"',1)[1].split('</div>',1)[0]
BAR = '<div id="local-find"'+BAR+'</div>'

def dump(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')))

def token(value):
    return sha256(value.encode()).hexdigest()[:24]

def page(path,title,section,content,*,meta='',cover=False):
    nav=''.join('<a href="'+u+'"'+(' aria-current="location"' if label==section else '')+'>'+label+'</a>' for u,label in NAV)
    search=BAR if path not in ('landscape.html','companies.html','projects.html') else ''
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

def cloud_rows(db):
    from d1 import query
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

def search_page():
    shell=Path('search.html').read_text()
    form=shell.split('<form id="archive-form">',1)[1].split('</form>',1)[0]
    form=re.sub(r'(<select name="(sector|year)"><option value="">[^<]+</option>).*?</select>',r'\1</select>',form)
    form += ('<label>细分方向<select name="sub"><option value="">全部方向</option></select></label>'
             '<label>轮次匹配<select name="mode"><option value="">关键词</option><option value="exact">精确轮次</option>'
             '<option value="family">含相邻轮次</option></select></label>'
             '<label>查看<select name="view"><option value="">融资事件</option><option value="companies">公司名单</option>'
             '<option value="institutions">机构名单</option></select></label>')
    page('search.html','融资交叉检索','融资事件','<form id="archive-form">'+form+'</form><p id="match-count" role="status"></p>'+financing_table('', 'matches')+SECTOR_SCRIPT+'<nav><button id="prev">上一页</button><button id="next">下一页</button></nav><script defer src="master-search.js?v=fa-projects1"></script>')

def research_pages(deals):
    publish_fa_assets(OUT)
    page('projects.html', '我的项目', '我的项目', FA_SCRIPTS + Path('projects-body.html').read_text())
    entry = Path('research-entry.html').read_text()
    for asset in ('workspace.css', 'workspace.js'):
        shutil.copyfile(asset, OUT/asset)
    home = OUT/'index.html'
    html = home.read_text()
    if '<main class="home-research">' in html:
        html = html.replace('<main class="home-research"><link rel="stylesheet" href="workspace.css">'+entry, '<main>', 1)
        html = html.replace('<h2>融资时间线</h2><p class="search-entry">','<p class="search-entry">',1)
        html = re.sub(r'<details><summary>按赛道浏览</summary>(<section class="arc">.*?</section>)</details>',r'\1',html,count=1,flags=re.S)
        home.write_text(re.sub(r'<small class="row-actions">.*?</small>', '', html))
    entry_script = ('<script>const workspaceParams=new URLSearchParams(location.search);'
                    'if(!workspaceParams.size)location.replace("company-research.html");'
                    'if(/^[a-f0-9]{24}$/.test(workspaceParams.get("client")||""))'
                    'document.currentScript.parentElement.classList.add("workspace-project")</script>')
    workspace_main = '<main class="workspace">'+entry_script+'<link rel="stylesheet" href="workspace.css?v=fa-projects1">'
    shell = (OUT/'search.html').read_text().replace('融资交叉检索 · 观势','研究工作区 · 观势').replace('<main>',workspace_main)
    shell = shell.replace('<h1>融资交叉检索</h1>', '<p class="work-kicker">研究工作区 · 服务项目</p><h1 id="work-title">研究工作区</h1>').replace(BAR, '').replace('<script src="within-page.js"></script>', '')
    reset = '<button type="reset">清除条件</button>'
    shell = shell.replace(reset, '', 1).replace('</form><p id="match-count"',
        '<div class="work-filter-actions">'+reset+'</div></form><p id="match-count"', 1)
    shell = shell.replace('<form id="archive-form">', entry + '<section id="fa-match-project" hidden></section>'
                          '<p id="work-context"></p><form id="archive-form">')
    shortlist = ('<details id="shortlist"><summary id="shortlist-summary">查看清单 '
                 '<span id="shortlist-count" role="status">已选 0 项</span></summary>'
                 '<p id="shortlist-empty">暂无已选对象</p><ul id="shortlist-items" hidden></ul></details>')
    shell = shell.replace('<p id="match-count" role="status"></p>',
        '<div class="work-results-bar"><p id="match-count" role="status">正在读取检索索引…</p>'+shortlist+'</div>')
    shell = shell.replace('<div class="finance-scroll" tabindex="0" role="region" aria-label="融资事件表">',
        '<div class="finance-scroll" tabindex="0" role="region" aria-label="检索结果" hidden>')
    shell = shell.replace('<script defer src="master-search.js?v=fa-projects1">',
        FA_SCRIPTS + '<script src="workspace.js?v=project2"></script>'
        '<script src="fa-match.js?v=3"></script><script defer src="master-search.js?v=fa-projects1">')
    (OUT/'workspace.html').write_text(shell)
    from company_research import publish
    publish(OUT,deals)

def build(rows, fund_facts=()):
    funds, reviewed_allocations = snapshot(fund_facts)
    OUT.mkdir(exist_ok=True)
    data=OUT/'records';data.mkdir(exist_ok=True)
    write_fund_index(OUT, funds)
    for asset in ('within-page.js','shelf.js','atlas.css','atlas.js','master-detail.js','master-search.js','load-shelf.js','company-browser.js','company-history.js'):
        shutil.copyfile(asset,OUT/asset)
    locations=json.loads(Path('country-locations.json').read_text())
    fund_managers=json.loads(Path('institution-fund-managers.json').read_text())
    reviewed_names_path = Path('company-display-names.json')
    reviewed_names = json.loads(reviewed_names_path.read_text()) if reviewed_names_path.is_file() else {}
    redirect_path = Path('historical-financing/reviewed-redirects.json')
    redirects = json.loads(redirect_path.read_text()) if redirect_path.is_file() else {}
    deal_redirects = redirects.get('deal', {})
    company_redirects = redirects.get('company', {})
    for mapping in (deal_redirects, company_redirects):
        if mapping.keys() & set(mapping.values()) or any(not re.fullmatch('[0-9a-f]{24}', key) for key in (*mapping, *mapping.values())):
            raise ValueError('Reviewed redirects must be one hop between valid record IDs')
    live=json.loads(Path('ledger.json').read_text())['events']
    old_by_source={u:e for e in live for u in e['sources']}
    history=json.loads(Path('history-public.json').read_text())
    old_history=defaultdict(list)
    for h in history:old_history[h['source']].append(h)
    profiles = {p["name"]: p for p in json.loads(Path("research-library.json").read_text())["profiles"]}
    companies={}; institutions={}; deals=[]; legacy={}; refs=defaultdict(list)
    institution_redirects = {}
    institution_aliases = defaultdict(set)
    legacy_sectors = defaultdict(set)
    legacy_parties = set()
    legacy_institution_sectors = defaultdict(set)
    direction_names = {}
    protected_names = {name for f in funds for name in (f['fundName'], f['managerName'])}
    protected_names.update(partner['name'] for f in funds for partner in f['partners']
                           if partner.get('existingInstitution') == token('institution' + partner['name']))
    protected_names.update(fund_managers)
    protected_names.update(v['brand'] for v in fund_managers.values())
    protected_names.update(n for v in fund_managers.values() for n in v.get('coManagers', ()))
    groups=defaultdict(list); buckets=defaultdict(dict); names=defaultdict(set)
    def entity(groups,kind,key,name):
        k=token(kind+key)
        return groups.setdefault(k,dict(key=k,name=name,href=kind+'.html?id='+k,events=[]))
    for row in sorted(rows,key=lambda r:(r['date_key'],r['event_id']),reverse=True):
        key=token('event'+row['event_id'])
        if row['round'] == '已合并披露':
            buckets['deal-'+key[:2]][key] = {'redirect': deal_redirects[key]}
            continue
        if key in deal_redirects:
            raise ValueError(f'Reviewed deal redirect before merge correction: {key}')
        urls=[u for u in json.loads(row['sources_json'] or '[]') if isinstance(u,str) and urlsplit(u).scheme in ('http','https')]
        c=entity(companies,'company',row['company_id'] or row['event_id'],row['company_name'])
        area,city=locations.get(row['company_id'] or row['event_id'],('',''))
        country=row.get('country') or area
        display=country
        if country=='中国' and area=='中国' and city:
            display=city
        elif country in ('中国香港','中国澳门','中国台湾'):
            display=country[2:]
        category = classify_sector(row['primary_sector'], row['secondary_sector'])
        raw_primary = row['primary_sector'] or '待归类'
        legacy_sectors[raw_primary].add(category.name)
        if category.direction_id:
            direction_names[category.direction_id] = category.direction
        d=dict(key=key,href='deal.html?id='+key,company=row['company_name'],companyHref=c['href'],day=row['date'],
               sector=category.name, sub=category.direction, sectorId=category.id, subId=category.direction_id,
               sectorBranches=category.branches,
               sectorEvidence={'primary': row['primary_sector'], 'secondary': row['secondary_sector'],
                               'label': row.get('sector'), 'source': row.get('sector_source')},
               stage=row['round'],amount=row['amount'],
               country=country,location=display,valuation=row['valuation'],dateKind=row['date_kind'],sources=urls,investors=[],parties=[],aliases=[],reports=[])
        c['events'].append(d);names[d['company']].add(c['href'])
        deal_institutions = {}
        disclosed_allocations = defaultdict(list)
        reviewed_ids = defaultdict(set)
        for item in json.loads(row['investors_json'] or '[]'):
            identity = participant(item, protected_names)
            n, raw = identity.name, identity.raw_name
            detail = item.get('contribution') if isinstance(item, dict) else None
            if raw:
                legacy_parties.add(raw)
                legacy_institution_sectors[raw_primary].add(raw)
                if old_relationship := fund_managers.get(raw):
                    managers = (old_relationship['brand'], *old_relationship.get('coManagers', ()))
                    legacy_parties.update(managers)
                    legacy_institution_sectors[raw_primary].update(managers)
            if raw and (n != raw or identity.roles or detail or
                        (isinstance(item, dict) and (item.get('amount') or item.get('source')))):
                observation = {'rawName': raw, 'name': n, 'roles': identity.roles, 'status': identity.status}
                if isinstance(item, dict):
                    for field in ('amount', 'contribution', 'source'):
                        if item.get(field) is not None:
                            observation[field] = item[field]
                if observation not in d.setdefault('participation', []):
                    d['participation'].append(observation)
            if not n:
                if raw:
                    archive = entity(institutions, 'institution', raw, raw)
                    archive['evidenceOnly'] = identity.status
                    if not archive['events'] or archive['events'][-1] is not d:
                        archive['events'].append(d)
                continue
            inst = entity(institutions, 'institution', n, n)
            if raw != n:
                old_key = token('institution' + raw)
                institution_redirects[old_key] = inst['key']
                institution_aliases[n].add(raw)
                reviewed_ids[inst['key']].add(old_key)
                legacy[filename('institution', raw)] = inst['href']
            if inst['key'] not in deal_institutions:
                deal_institutions[inst['key']] = inst
                d['investors'].append(n)
                d['parties'].append([n, inst['href']])
            if value := contribution(detail, urls):
                disclosed_allocations[inst['key']].append(value)
            if fund_manager := fund_managers.get(n):
                for manager in (fund_manager['brand'], *fund_manager.get('coManagers', ())):
                    brand = entity(institutions, 'institution', manager, manager)
                    relationships = brand.setdefault('relatedInstitutions', {})
                    relationships[inst['key']] = (n, inst['href'], fund_manager['source'], '关联投资主体')
                    inst.setdefault('relatedInstitutions', {})[brand['key']] = (
                        manager, brand['href'], fund_manager['source'], '管理或品牌关系')
        for inst_id, institution in deal_institutions.items():
            institution['events'].append(d)
            values = disclosed_allocations[inst_id]
            if not values:
                reviewed = reviewed_allocations.get(key, {})
                for related_id in sorted(reviewed_ids[inst_id] | {inst_id}):
                    if value := contribution(reviewed.get(related_id), urls):
                        values.append(value)
            if len({(v['amountFen'], v['basis']) for v in values}) > 1:
                d.setdefault('allocationConflicts', []).append(inst_id)
            elif values:
                d.setdefault('partyAllocations', []).append({'institutionId': inst_id, **values[0]})
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
        if row['event_id'].startswith('public:historical-disclosure:'):
            # Reviewed imports store verified company names as semicolon-separated aliases.
            aliases = (row.get('raw_company_key') or '').replace('；', ';').split(';')
            for alias in map(str.strip, aliases):
                if alias and alias != d['company'] and alias not in d['aliases']:
                    d['aliases'].append(alias)
        if label := reviewed_names.get(c['key']):
            display_name = label['name']
            d['aliases'] = list(dict.fromkeys(
                name for name in (d['company'], label['registeredName'], *label['aliases'], *d['aliases'])
                if name and name != display_name
            ))
            d['company'] = display_name
        if d['stage'] not in OUT_OF_FINANCING:
            groups[d['sector']].append(d)
            deals.append(d)
        buckets['deal-'+key[:2]][key]=d
    for old, current in deal_redirects.items():
        if old not in buckets.get('deal-'+old[:2], {}) or current not in buckets.get('deal-'+current[:2], {}):
            raise ValueError(f'Reviewed deal redirect references a missing record: {old}')
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
    for section,slug in [('研究周报','reports'),('变化追踪','changes')]:
        original=Path(slug+'.html').read_text()
        found=re.search(r'<section class="arc">.*?</section>',original,re.S)
        if found:
            DECKS[section]='records/shelf-'+slug+'.html'
            (OUT/DECKS[section]).write_text(found[0])
    list_pages('index.html','融资时间线','融资事件',deals,event_row,
        '<p class="search-entry">'+link('search.html',f'检索全部 {len(deals):,} 笔融资 →')+'</p>'+deck('融资事件',counts))
    for sector,items in groups.items():list_pages(filename('sector',sector),sector,'融资事件',items,event_row)
    lp_disclosures = defaultdict(list)
    lp_fund_relations = defaultdict(list)
    for fund in funds:
        entity(institutions, 'institution', fund['fundName'], fund['fundName'])
        entity(institutions, 'institution', fund['managerName'], fund['managerName'])
        for partner in fund['partners']:
            name = partner['name']
            if partner.get('existingInstitution') == token('institution' + name):
                entity(institutions, 'institution', name, name)
    coverage = register_coverage(funds, institutions)
    for fund in funds:
        fund_id, manager_id = fund['fundId'], fund['managerId']
        if any(key in institutions and institutions[key]['name'] != label for key, label in (
            (fund_id, fund['fundName']), (manager_id, fund['managerName']),
        )):
            raise ValueError(f'Fund LP disclosure refers to an unknown profile: {fund_id}')
        if urlsplit(fund['source']['url']).scheme != 'https':
            raise ValueError(f'Fund LP disclosure requires an HTTPS source: {fund_id}')
        for partner in fund['partners']:
            partner_id = partner.get('existingInstitution')
            if partner_id not in institutions:
                partner['existingInstitution'] = None
            else:
                lp_fund_relations[partner_id].append({
                    'fundId': fund_id, 'fundName': fund['fundName'], 'disclosedPercent': partner['disclosedPercent'],
                    'source': fund['source'],
                })
        for key in {fund_id, manager_id} & institutions.keys():
            lp_disclosures[key].append(fund)
    for kind,entities,index,section in [('company',companies,'companies.html','公司档案'),('institution',institutions,'institutions.html','机构档案')]:
        by_sector=defaultdict(list);parts=defaultdict(dict)
        for k,entity_row in entities.items():
            items=entity_row['events']
            visible = [d for d in items if d['stage'] not in OUT_OF_FINANCING and not entity_row.get('evidenceOnly')]
            for sector in dict.fromkeys(d['sector'] for d in visible):by_sector[sector].append(entity_row)
            parts[k[:2]][k]={'name':entity_row['name'],'events':[
                [d['href'],d['company'],d['day'],d['stage'],d['amount'],d['sector'],d['sub'],d['companyHref'],d['sectorBranches']]
                for d in items]}

            if kind=='company':
                profile = profiles.get(entity_row['name']) if len(names[entity_row['name']]) == 1 else None
                latest = (visible or items)[0]
                preferred = next((d for d in visible if d['sectorId'] != 'unknown'), latest)
                parts[k[:2]][k].update(profile=profile, primary=preferred['sector'], sub=preferred['sub'],
                    primaryId=preferred['sectorId'], subId=preferred['subId'], location=latest['location'],
                    hasFineDirection=has_fine_direction(preferred['sector'], preferred['sub']),
                    sector=preferred['sub'] or preferred['sector'],
                    events=[[d['href'],d['day'],d['stage'],d['amount'],d['parties'],d['sources'],d['sector'],d['sub']] for d in items])
            else:
                if entity_row.get('evidenceOnly'):
                    parts[k[:2]][k]['evidenceOnly'] = entity_row['evidenceOnly']
                if relations := entity_row.get('relatedInstitutions'):
                    parts[k[:2]][k]['relatedInstitutions'] = sorted(relations.values())
                if aliases := institution_aliases.get(entity_row['name']):
                    parts[k[:2]][k]['aliases'] = sorted(aliases)
                if k in lp_disclosures:
                    parts[k[:2]][k]['fundDisclosures'] = lp_disclosures[k]
                if k in coverage:
                    parts[k[:2]][k]['fundCoverage'] = {field: value for field,value in coverage[k].items()
                                                        if field != 'missingEventIds'}
                if k in lp_fund_relations:
                    parts[k[:2]][k]['lpFundRelations'] = lp_fund_relations[k]
            old=filename(kind,entity_row['name'])
            if Path(old).exists() and (kind=='institution' or len(names[entity_row['name']])==1):legacy[old]=entity_row['href']
            if kind == 'company' and (label := reviewed_names.get(k)):
                entity_row['name'] = label['name']
                parts[k[:2]][k].update(
                    name=label['name'], registeredName=label['registeredName'],
                    aliases=label['aliases'], nameSources=label['sources'],
                )
        if kind == 'company':
            for old, current in company_redirects.items():
                if old in entities or current not in entities:
                    raise ValueError(f'Reviewed company redirect conflicts with active companies: {old}')
                # Keep old IDs readable for views that resolve the company shard directly.
                parts[old[:2]][old] = {**parts[current[:2]][current], 'redirect': current}
        if kind=='institution':
            for old, current in institution_redirects.items():
                if old not in entities:
                    parts[old[:2]][old] = {'redirect': current}
        for prefix,part in parts.items():dump(data/(kind+'-'+prefix+'.json'),part)
        if kind=='company':
            from company_directory import build_directory
            build_directory(entities,by_sector,data,OUT,page,dump,link,redirect,sector_url,OUT_OF_FINANCING)
            continue
        def entry(e):return '<div class="directory-row">'+link(e['href'],e['name'])+f'<small>{len(e["events"])} 笔投资记录</small></div>'
        directory=sorted((e for e in entities.values() if not e.get('evidenceOnly')),key=lambda e:(-len(e['events']),e['name']))
        list_pages(index,section,section,directory,entry,(link('research-companies.html','公司研究库与同行对照 →') if kind=='company' else '')+link('search.html','检索全部融资 →')+deck(section,Counter({s:len(v) for s,v in by_sector.items()})))
        for s,items in by_sector.items():list_pages(sector_url(section,s),s,section,items,entry)
        old_names = legacy_parties | {row['name'] for row in entities.values() if not row['events']}
        for page_number in range(2, (len(old_names) + 59) // 60 + 1):
            path = f'institutions-{page_number}.html'
            if not (OUT / path).exists():
                redirect(path, 'institutions.html')
        for label, members in legacy_institution_sectors.items():
            base = sector_url(section, label)
            for page_number in range(1, (len(members) + 59) // 60 + 1):
                path = base if page_number == 1 else base[:-5]+f'-{page_number}.html'
                if not (OUT / path).exists():
                    redirect(path, 'institutions.html?'+urlencode({'sector': label}))
    raw_sector_counts = Counter(d['sectorEvidence']['primary'] or '待归类' for d in deals)
    for raw, normalized in legacy_sectors.items():
        if normalized == {raw}:
            continue
        count = raw_sector_counts[raw]
        for section in ('融资事件', '公司档案', '机构档案'):
            for i in range(max(1, (count + 59) // 60)):
                base = sector_url(section, raw)
                old = base if not i else base[:-5] + f'-{i+1}.html'
                if not (OUT / old).exists():
                    route = {'融资事件': 'search.html', '公司档案': 'companies.html', '机构档案': 'institutions.html'}[section]
                    redirect(old, route+'?'+urlencode({'sector': raw}))

    for kind,title,section in [('company','公司档案','公司档案'),('institution','机构档案','机构档案'),('deal','融资详情','融资事件')]:
        default=legacy.pop(kind+'.html','')
        detail_version = 'foundation-1'
        page(kind+'.html',title,section,'<section id="record" data-kind="'+kind+'" data-default="'+esc(default)+'"></section><script defer src="master-detail.js?v='+detail_version+'"></script>')
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
    for d in deals:by_year[d['day'][:4] or '未列明'].append([d[k] for k in ('key','company','aliases','day','sector','stage','amount','investors','valuation','sub','location')]+[d['companyHref'], d['sectorBranches']])
    for year,items in by_year.items():dump(data/('search-'+year+'.json'),items)
    subs = {}
    for sector, items in groups.items():
        sub_names = {d['sub'] for d in items if d['sub']}
        sub_names.update(BRANCHES[branch] for d in items for branch in d['sectorBranches'])
        subs[sector] = sorted(sub_names)
    aliases = {
        name: sorted(values | set(REVIEWED_ALIASES.get(name, {}).get('aliases', ())))
        for name, values in institution_aliases.items()
    }
    for name, evidence in REVIEWED_ALIASES.items():
        if token('institution'+name) in institutions:
            aliases.setdefault(name, [n for n in evidence['aliases'] if n not in protected_names])
    manifest={'events':len(deals),'companies':len(companies),
              'institutions':sum(not row.get('evidenceOnly') for row in institutions.values()),
              'years':list(by_year),'sectors':list(groups),'subs':subs, 'institutionAliases':aliases,
              **write_search_indexes(data, chain.from_iterable(by_year.values())),
              'taxonomyVersion': 1}
    dump(data/'manifest.json',manifest)
    public_filter(OUT, direction_names)
    search_page()
    research_pages(deals)
    for p in Path('.').glob('research-company-*.html'):
        if not (OUT/p.name).exists():
            title=re.search(r'<h1>(.*?)</h1>',p.read_text()).group(1)
            redirect(p.name,'search.html?'+urlencode({'company':title}))
    redirect('find.html','search.html')
    assert sum(len(v) for v in groups.values())==len({d['key'] for d in deals})
    assert sum(len(bucket) for bucket in buckets.values())==len(rows)
    print(manifest['events'], 'published events;',len(companies),'company groups;',len(institutions),'institution names')

    return coverage

if __name__ == '__main__':
    from d1 import database, query
    db = database()
    facts = prepare_cloud(db, query)
    coverage = build(cloud_rows(db), facts)
    statuses = coverage_facts(coverage)
    changed, obsolete = replace_derived(db, query, statuses, facts)
    print(f'Fund coverage verified for {len(coverage)} funds, {len(statuses)} coverage and deal relationships, '
          f'{changed} writes, {obsolete} obsolete derived records removed')
