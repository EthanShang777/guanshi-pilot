"""Publish a static, source-linked ChinaVenture financing timeline."""
import argparse
import hashlib
import html
import json
import re
import subprocess
from datetime import date, timedelta
from pathlib import Path

BASE = "https://www.chinaventure.com.cn"
STATE = Path("ledger.json")
SEED = "三有利康"
ROW = re.compile(r'<h1>\s*<a[^>]+href="(/flash/(\d{8})-\d+\.html)"[^>]*>(.*?)</a>\s*</h1>\s*<p>(.*?)<span', re.S)
COMPANY = re.compile(r'^(.{1,36}?)(?:宣布完成|宣布获得|已完成|再次获得|再获|完成|获得|获)')
ROUND = re.compile(r'(?:Pre[-－ ]?)?[A-H][＋+\d-]*\s*轮|种子轮|天使轮|战略融资', re.I)

def fetch(url, *args):
    return subprocess.check_output(["curl", "-fsSL", "--retry", "3", "--max-time", "45", *args, url]).decode()

def clean(value):
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()

def scan(state):
    raw = fetch(BASE + "/flash/list.html")
    rows = [(url, date.fromisoformat(day).isoformat(), clean(title), clean(body))
            for url, day, title, body in ROW.findall(raw)]
    if not rows:
        raise ValueError("快讯结构异常")
    cutoff = state.get("through", rows[0][1])
    page = 1
    while rows[-1][1] >= cutoff and len(rows) >= 20:
        payload = fetch(BASE + "/api/getFlashList", "-d", f"begin_num=21&size=20&page={page}")
        more = json.loads(payload)["data"]["flash_list"]
        if not more:
            break
        last = rows[-1][0]
        for item in more:
            path = item["flash_url"].removeprefix(BASE)
            match = re.fullmatch(r"/flash/(\d{8})-\d+\.html", path)
            if not match:
                raise ValueError("未知快讯链接")
            rows.append((path,date.fromisoformat(match[1]).isoformat(),clean(item["flash_title"]),clean(item["flash_desc"])))
        if rows[-1][0] == last:
            raise ValueError("分页未前进")
        page += 1
    return [row for row in rows if row[1] >= cutoff]

def investors(body):
    # Historical rounds and advisers are outside this disclosure's investor list.
    body = re.split(r'(?:此前|早前|过往|历史上|上一轮融资)', body, maxsplit=1)[0]
    body = re.sub(r'等(?:知名)?(?:投资机构|产业资本|机构)?(?=与产业资本|等|联合投资|投资|[，。])', '', body)
    names = []
    groups = re.findall(r'(?:投资方为|新增投资方包括)([^，。；]+)',body)
    pattern = r'(?:由|，)([^，。；]{1,100}?)(?:独家直投|独家投资|联合领投|联合投资|共同投资|领投|跟投|投资)(?=[，。；\s]|$)'
    groups.extend(re.findall(pattern,body))
    for group in groups:
        group = re.sub(r'^(?:(?:本轮|本次)(?:融资|交割)?)?由','',group).split('等')[0].split('与产业资本')[0]
        group = re.sub(r'（简称[“"].*?[”"]）','',group)
        for name in re.split(r'、|以及|和(?=[^）]*(?:（|$))',group):
            if name not in {'产业资本','产业投资方','机构投资者','老股东'} and re.fullmatch(r'[\w·（）/－-]{2,30}',name) and not re.search(r'多家|本轮|本次|公司宣布|包括|等|担任|天使轮|分别由',name):
                names.append(name)
    return list(dict.fromkeys(names))

# Public display names matched to the primary sectors in the local V2 timeline.
COMPANY_SECTORS = {
    "数字光芯": "芯片与算力", "森木磊石": "工业制造", "昂拓生物": "医疗健康",
    "三有利康": "医疗健康", "瑞莱谱": "医疗健康",
}
BUSINESS_TERMS = {
    "医疗健康": ("细胞治疗", "核酸药物", "医疗器械", "制药企业", "医疗质谱"),
    "芯片与算力": ("芯片设计企业", "驱动芯片企业", "算力芯片", "半导体设备企业"),
    "工业制造": ("工业装备制造", "智能装备制造"),
}

def classify(company, body):
    if company in COMPANY_SECTORS:
        return COMPANY_SECTORS[company]
    matches = [sector for sector,terms in BUSINESS_TERMS.items() if any(word in body for word in terms)]
    return matches[0] if len(matches)==1 else "待归类"

def apply(state, rows):
    events = state["events"]
    before = len(events)
    linked = skipped = 0
    for path, day, title, body in sorted(rows):
        url = BASE + path
        m = COMPANY.search(title)
        if not m or not re.search(r'融资|投资',title):
            skipped += 1
            continue
        company = m[1].strip(' ，：“”')
        match = ROUND.search(title) or ROUND.search(body)
        stage = match[0].replace(' ','').upper() if match else ''
        parties = investors(body)
        existing = next((e for e in events if url in e["sources"]),None)
        if not existing:
            candidates = [e for e in events if e["company"]==company and
                          (e["title"]==title and e["day"]==day or
                           stage and e["round"]==stage and set(parties)&set(e["investors"])
                           and abs(date.fromisoformat(e["day"])-date.fromisoformat(day))<=timedelta(days=7))]
            if len(candidates)==1:
                existing = candidates[0]
        if existing:
            if existing.get("sector","待归类")=="待归类":
                existing["sector"]=classify(company,body)
            if url not in existing["sources"]:
                existing["sources"].append(url)
                linked += 1
            existing["investors"] = list(dict.fromkeys(existing["investors"]+parties))
        else:
            events.append(dict(id=path.split('-')[-1][:-5],day=day,company=company,title=title,sector=classify(company,body),
                               round=stage,first_close=('首次交割' in body or '首关' in body),investors=parties,sources=[url]))
    state["through"] = max([state.get("through","")]+[r[1] for r in rows])
    print(f"扫描 {len(rows)} 条，新增 {len(events)-before} 笔，已有事件追加 {linked} 个来源，未收录 {skipped} 条")

def filename(kind, name):
    if (kind,name) in [('company',SEED),('institution','烟台生命岛')]:
        return kind+'.html'
    return kind+'-'+hashlib.sha256(name.encode()).hexdigest()[:20]+'.html'

def event_url(e):
    return 'event.html' if e['id']=='seed' else 'event-'+e['id']+'.html'

def link(url, label):
    return f'<a href="{html.escape(url,quote=True)}">{html.escape(label)}</a>'

def render(events):
    from itertools import groupby
    from reader import TOPICS, build_library

    css = Path('site.css').read_text()
    nav_items = [('index.html','融资事件'), ('companies.html','公司档案'), ('institutions.html','机构档案'), ('reports.html','研究周报'), ('landscape.html','赛道画布'), ('changes.html','变化追踪')]

    from finder import SearchText, build_finder
    searchable=[]
    local_script=Path("within-page.js").read_text()

    shelves = {}
    def shelf(label, choices):
        cards, records = [], []
        for title, detail, href in choices:
            cards.append('<div class="arc-slot"><button class="arc-card">'+
                         '<strong>'+html.escape(title)+'</strong><b>'+html.escape(detail)+'</b></button></div>')
            records.append('<article class="arc-record" hidden><h2>'+link(href,title+' →')+'</h2></article>')
        if not cards:
            return ''
        return ('<section class="arc"><div class="arc-track" tabindex="0" aria-label="'+label+'，左右滑动">'+
                ''.join(cards)+'</div><div class="arc-bottom"><div>'+''.join(records)+'</div><div class="arc-controls">'+
                '<button aria-label="上一分类">‹</button><output></output><button aria-label="下一分类">›</button>'+
                '</div></div></section>')

    def page(path, title, section, content, *, meta='', cover=False):
        nav = ''.join(
            f'<a href="{url}"' + (' aria-current="location"' if label == section else '') + f'>{label}</a>'
            for url,label in nav_items
        )
        if path!='find.html' and not path.startswith('archive-'):
            parser=SearchText()
            parser.feed(content)
            searchable.append([title,section,path,' '.join([meta,*parser.parts])])
        if path!='landscape.html' and 'class="arc-track"' not in content:
            deck = shelves.get(section) or shelf('浏览栏目', [(label,'',url) for url,label in nav_items])
            content = deck+content if path in dict(nav_items) else content+deck
        content += '<script defer src="shelf.js"></script>'
        caption = f'<p>{html.escape(meta)}</p>' if meta else ''
        search_bar = '<div id="local-find" role="search" aria-label="在此页查找"><input type="search" aria-label="本页关键词" placeholder="在此页查找"><output aria-live="polite"></output><button hidden disabled aria-label="上一处">↑</button><button hidden disabled aria-label="下一处">↓</button><button hidden aria-label="清除关键词">×</button></div>' if path!='landscape.html' else ''
        local_js = local_script if search_bar else ''
        Path(path).write_text(f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} · 观势</title><style>{css}</style></head>
<body><header class="top"><a class="brand" href="index.html">观势</a>
<nav aria-label="栏目">{nav}</nav></header>
<main><header class="hero {'cover' if cover else ''}">{caption}<h1>{html.escape(title)}</h1></header>
{search_bar}
{content}</main><script>{local_js}</script></body></html>''')

    ordered = sorted(events,key=lambda e:(e['day'],e['id']),reverse=True)
    historical = json.loads(Path('history-public.json').read_text())
    reports = json.loads(Path('research-index.json').read_text())
    return_link = """<script>(()=>{const value=new URLSearchParams(location.search).get('fromSearch');if(value===null)return;const q=new URLSearchParams(value),focus=q.get('focus');q.delete('focus');const a=document.createElement('a');a.href='search.html?'+q+(focus?'#'+encodeURIComponent(focus):'');a.textContent='← 返回筛选结果';document.querySelector('main').prepend(a)})();</script>"""
    index_rows = []
    for event in ordered:
        index_rows.append(dict(key=event['id'],company=event['company'],investors=event['investors'],aliases=[],day=event['day'],
                               sector=event.get('sector','待归类'),stage=event['round'],amount=event.get('amount_display',''),href=event_url(event)))
    sectors = {}
    for event in ordered:
        sector = event.get("sector", COMPANY_SECTORS.get(event["company"], "待归类"))
        sectors.setdefault(sector, []).append(event)
    shelves['融资事件'] = shelf('行业赛道', [(sector,f'{len(items)} 笔融资',filename('sector',sector))
                                          for sector,items in sectors.items()])
    for section, key, index in [('公司档案','company','companies.html'),('机构档案','institution','institutions.html')]:
        choices = []
        for sector,items in sectors.items():
            names = {name for e in items for name in ([e['company']] if key=='company' else e['investors'])}
            if names:
                choices.append((sector,f'{len(names)} 家',index+'#'+filename('group',sector)[:-5]))
        shelves[section] = shelf('行业赛道',choices)
    topics = [(name,str(sum(r['topic']==key for r in reports.values()))+' 期研究','landscape-'+key+'.html')
              for key,name in TOPICS.items()]
    for section in ('研究周报','赛道画布'):
        shelves[section] = shelf('研究方向',topics)
    reviews = json.loads(Path('research-library.json').read_text())['reviews']
    months = sorted({r['day'][:7] for r in reviews},reverse=True)
    shelves['变化追踪'] = shelf('复核月份',[(m,str(sum(r['day'].startswith(m) for r in reviews))+' 项复核',
                                           '#review-'+m) for m in months])
    linked_sources = {u for event in ordered for u in event['sources']}
    research_companies = {}
    for row in historical:
        if row['source'] in linked_sources and any(e['company']==row['company'] and row['source'] in e['sources'] for e in ordered):
            continue
        href = 'historical-'+row['key']+'.html'
        index_rows.append({**row,'href':href})
        citations = [link('report-'+rid+'.html',reports[rid]['title']) for rid in row.get('reports',[])]
        body = (f'<div class="deal-summary"><div><small>历史记录金额</small><strong>{html.escape(row["amount"] or "未列明")}</strong></div>'
                f'<div><small>轮次</small><strong>{html.escape(row["stage"] or "未列明")}</strong></div></div>'
                '<section class="counterparties"><h2>档案所列参与方</h2><p>'+html.escape('、'.join(row['investors']) or '未列明')+'</p></section>')
        if citations:
            research_companies.setdefault(row['company'],[]).append(row)
            body+='<section class="counterparties"><h2>相关研究</h2>'+''.join(citations)+link(filename('research-company',row['company']),'公司研究档案 →')+'</section>'
        page(href,row['company'],'融资事件',body+'<footer class="evidence">'+link(row['source'],'投中网报道 ↗')+'</footer>'+return_link,
             meta=(row['date_kind'] or '档案日期')+'　'+row['day'])
    for name,items in research_companies.items():
        refs=dict.fromkeys(rid for item in items for rid in item['reports'])
        body='<section class="counterparties"><h2>融资记录</h2>'+''.join(link('historical-'+r['key']+'.html',r['day']+' · '+r['stage']) for r in items)+'</section>'
        body+='<section class="counterparties"><h2>相关研究</h2>'+''.join(link('report-'+rid+'.html',reports[rid]['title']) for rid in refs)+'</section>'
        page(filename('research-company',name),name,'公司档案',body,meta='历史研究档案')
    build_library(page,link,filename,reports,research_companies,index_rows,ordered)
    options=''.join('<option>'+html.escape(s)+'</option>' for s in sorted({r['sector'] for r in index_rows}))
    years=sorted({r['day'][:4] for r in index_rows if r['day']}, reverse=True)
    year_options=''.join('<option>'+html.escape(y)+'</option>' for y in years)
    controls=('<p class="intro">每日试站记录及有投中网公开报道的历史样本。</p><form id="archive-form"><label>公司<input name="company" type="search"></label>'
              '<label>投资机构<input name="investor" type="search"></label><label>赛道<select name="sector"><option value="">全部赛道</option>'+options+
              '</select></label><label>年份<select name="year"><option value="">全部年份</option>'+year_options+'</select></label><label>轮次关键词<input type="search" name="stage"></label><button type="reset">清除条件</button></form><p id="match-count" aria-live="polite"></p><section id="matches"></section>'
              '<nav><button id="prev">上一页</button><button id="next">下一页</button></nav>')
    public_keys=('key','href','company','day','sector','stage','amount','investors','aliases')
    data=json.dumps([{k:r[k] for k in public_keys} for r in sorted(index_rows,key=lambda r:r['day'],reverse=True)],ensure_ascii=False).replace('<',r'\u003c')
    page('search.html','融资交叉检索','融资事件',controls+'<script type="application/json" id="search-data">'+data+'</script><script>'+Path('search.js').read_text()+'</script>',cover=True)
    def dispatch(e):
        company = html.escape(e['company'])
        headline = html.escape(e['title'].removeprefix(e['company']).strip() or e['title'])
        parties = '、'.join(link(filename('institution', n), n) for n in e['investors'])
        return (f'<article class="dispatch"><h3><a href="{event_url(e)}">{company}'
                f'<span>{headline}</span></a></h3><p>{parties}</p></article>')



    page_size = 24

    def sector_shelf():
        cards, records = [], []
        for sector,items in sorted(sectors.items(),key=lambda pair:(pair[0]=="待归类",-len(pair[1]),pair[0])):
            name = html.escape(sector)
            cards.append(f'<div class="arc-slot"><button class="arc-card" aria-label="选择{name}赛道">'
                         f'<strong>{name}</strong><b>{len(items)} 笔融资</b></button></div>')
            records.append('<article class="arc-record" hidden><h2>'+link(filename('sector',sector),name+' →')+'</h2>'
                           '<p>最近披露 · '+html.escape(items[0]['title'])+'</p></article>')
        return ('<section class="arc"><div class="arc-track" tabindex="0" aria-label="行业赛道，左右滑动">'+
                ''.join(cards)+'</div><div class="arc-bottom"><div>'+''.join(records)+'</div><div class="arc-controls">'
                '<button aria-label="上一赛道">‹</button><output></output><button aria-label="下一赛道">›</button>'
                '</div></div></section>') if cards else ''

    def terms(e):
        return ' · '.join(filter(None,[e['round'], '首关' if e.get('first_close') else '',e.get('amount_display')]))

    def sector_entry(e):
        description = e.get('business','')
        return ('<article class="deal"><small>'+html.escape(description or e['day'])+'</small><h2>'+
                link(event_url(e),e['company'])+'</h2><p>'+html.escape(terms(e) if e.get('amount_display') else e['title'])+
                '</p>'+link(event_url(e),'查看融资详情 →')+'</article>')

    def reading_pick():
        latest=max(r['week'] for r in reports.values())
        choices=[(rid,r) for rid,r in reports.items() if r['week']==latest and r.get('lead_evidence')]
        choices.sort(key=lambda pair:pair[1]['topic']!='world-model')
        for rid,r in choices:
            evidence=next((e for e in r['events'] if e['title']==r['lead_evidence'] and e['sources']),None)
            if evidence:
                return ('<aside class="reading-pick"><small>研究选读　·　'+html.escape(latest)+' 归档</small><h2>'+
                        link('report-'+rid+'.html',r['reading_lead'])+'</h2><p>'+link('report-'+rid+'.html','阅读周报 →')+
                        '　'+link(evidence['sources'][0]['url'],'查看证据 ↗')+'</p></aside>')
        return ''

    def archive_page(batch, number, total, sector=None):
        editions = []
        for day, entries in groupby(batch,key=lambda e:e['day']):
            stamp = date.fromisoformat(day)
            rows = ''.join(dispatch(e) for e in entries)
            editions.append(f'<section class="edition"><h2 class="folio"><time datetime="{day}"><small>{stamp.year}</small>'
                            f'{stamp:%m}<em>/</em>{stamp:%d}</time></h2><div class="dispatches">{rows}</div></section>')
        def url(i):
            if sector:
                base=filename('sector',sector)[:-5]
                return base+('.html' if i==1 else f'-{i}.html')
            return 'index.html' if i==1 else f'archive-{i}.html'
        pager = ''
        if total>1:
            pager = '<nav aria-label="融资时间线分页">'+(link(url(number-1),'上一页') if number>1 else '')+f'<span>{number} / {total}</span>'+(link(url(number+1),'下一页') if number<total else '')+'</nav>'
        featured = number==1 and sector is None
        content = ('<p class="search-entry">'+link("search.html","检索公司、投资机构与赛道 →")+'</p>'+reading_pick()+sector_shelf() if featured else '')+pager+''.join(editions)
        if sector:
            info = f'<div class="sector-summary"><strong>{len(sectors[sector])} 笔融资</strong><span>最近披露　{sectors[sector][0]["day"]}</span></div>'
            content = info+pager+''.join(sector_entry(e) for e in batch)
        page(url(number),sector or '融资时间线','融资事件',content,meta='行业赛道' if sector else '',cover=True)

    def paginate(items,sector=None):
        total = max(1,(len(items)+page_size-1)//page_size)
        for i in range(total):
            archive_page(items[i*page_size:(i+1)*page_size],i+1,total,sector)
    paginate(ordered)
    for sector,items in sectors.items():
        paginate(items,sector)
    for e in ordered:
        sector = e.get('sector', COMPANY_SECTORS.get(e['company'],'待归类'))
        money = html.escape(e.get('amount_display') or '见原文')
        stage = html.escape(e.get('round') or '见原文')
        scope = '首次交割金额' if e.get('first_close') else '披露融资金额'
        parties = ''.join(link(filename('institution',n),n+' →') for n in e['investors'])
        role = html.escape(e.get('investor_role','参投'))
        notes = ''
        if e['id']=='seed':
            notes = '<dl class="details"><div><dt>融资用途</dt><dd>推进核心管线临床试验和研究者发起的临床研究。</dd></div><div><dt>财务顾问</dt><dd>微纳资本（独家）</dd></div></dl>'
        sources = ' · '.join(link(u,'投中网原文 ↗' if i==0 else '相关披露 ↗') for i,u in enumerate(e['sources']))
        headline = '' if e.get('amount_display') else '<p class="intro">'+html.escape(e['title'])+'</p>'
        content = (f'<div class="deal-summary"><div><small>{scope}</small><strong>{money}</strong></div>'
                   f'<div><small>融资轮次</small><strong>{stage}</strong></div></div>'+headline+
                   f'<section class="counterparties"><h2>{role}机构</h2>{parties or "见原文"}</section>'+notes+
                   '<footer class="evidence">'+link(filename('company',e['company']),'公司档案')+' · '+
                   link(filename('sector',sector),sector)+' · '+sources+'</footer>')
        page(event_url(e),e['company'],'融资事件',content+return_link,meta='融资披露　'+e['day'])

    for kind,label,index in [('company','公司档案','companies.html'),('institution','机构档案','institutions.html')]:
        groups = {}
        for e in ordered:
            for name in ([e['company']] if kind=='company' else e['investors']):
                groups.setdefault(name,[]).append(e)
        is_company = kind == 'company'
        rows = []
        for name,items in groups.items():
            latest = items[0]
            sector = latest.get('sector','待归类')
            context = ' · '.join(filter(None,(sector,latest['round']))) if is_company else '最近参投 · '+latest['company']
            rows.append(f'<a class="directory-row" href="{filename(kind,name)}"><span><strong>{html.escape(name)}</strong>'
                        f'<small>{html.escape(context)}</small></span><i aria-hidden="true">→</i></a>')
        row_by_name = dict(zip(groups,rows))
        if is_company:
            for name in research_companies:
                if name not in groups:
                    rows.append(link(filename('research-company',name),name+' · 历史研究档案'))
        count_label = '家公司' if is_company else '家机构'
        directory = f'<div class="sector-summary"><strong>试站收录 {len(rows)} {count_label}</strong></div>'
        grouped = []
        for sector,items in sectors.items():
            names = dict.fromkeys(n for e in items for n in ([e['company']] if is_company else e['investors']))
            if names:
                grouped.append('<section id="'+filename('group',sector)[:-5]+'"><h2>'+html.escape(sector)+'</h2>'+
                               ''.join(row_by_name[n] for n in names)+'</section>')
        directory_body = ''.join(grouped)+''.join(rows[len(groups):])
        page(index,label,label,(link('research-companies.html','公司研究库与同行对照 →') if is_company else '')+directory+'<div class="profile-directory">'+directory_body+'</div>',cover=True)
        for name,items in groups.items():
            desc = {'三有利康':'北京三有利康细胞科技有限公司成立于 2021 年，研发精准亚型间充质干细胞药物。',
                    '烟台生命岛':'投中网披露的三有利康 Pre-A 轮投资方。'}.get(name,'')
            latest = items[0]
            sector = latest.get('sector','待归类')
            metric = ('所属赛道',link(filename('sector',sector),sector)) if is_company else (
                '收录被投公司',str(len({e['company'] for e in items}))+' 家')
            summary = (f'<div class="deal-summary profile-summary"><div><small>{metric[0]}</small><strong>{metric[1]}</strong></div>'
                       f'<div><small>收录融资事件</small><strong>{len(items)} 笔</strong></div></div>')
            records = []
            for e in items:
                caption = (e['round'] or '融资') if is_company else e['company']
                fact = terms(e) if e.get('amount_display') else e['title']
                if is_company and e.get('amount_display'):
                    fact = ('首次交割金额 · ' if e.get('first_close') else '披露金额 · ')+e['amount_display']
                parties = '、'.join(link(filename('institution',n),n) for n in e['investors'])
                related = f'<p class="related">参投机构　{parties}</p>' if is_company and parties else ''
                records.append('<article class="deal"><small>披露于 '+html.escape(e['day'])+'</small><h3>'+
                               link(event_url(e),caption)+'</h3><p>'+html.escape(fact)+'</p>'+related+
                               link(event_url(e),'查看融资详情 →')+'</article>')
            intro = '<p class="intro">'+html.escape(desc)+'</p>' if desc else ''
            heading = '融资历程' if is_company else '参投记录'
            layout = ''
            if not is_company:
                matrix = {}
                for row in index_rows:
                    if name in row['investors']:
                        matrix.setdefault((row['sector'],row['stage'] or '阶段未列明'),[]).append(row)
                cells = ''.join('<details class="research-node"><summary>'+html.escape(sector+' · '+stage)+
                                f' · {len(deals)} 项</summary>'+''.join('<p>'+link(r['href'],r['company']+' · '+r['day'])+'</p>' for r in deals)+'</details>'
                                for (sector,stage),deals in sorted(matrix.items()))
                layout = '<section class="profile-records"><h2>投资布局</h2><p>检索样本中按机构名称精确匹配的融资记录</p>'+cells+'</section>'
            page(filename(kind,name),name,label,summary+intro+f'<section class="profile-records"><h2>{heading}</h2>'+
                 ''.join(records)+'</section>'+layout,meta=label)

    build_finder(page,searchable)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--replay-check',action='store_true')
    parser.add_argument('--ingest-only',action='store_true')
    args=parser.parse_args()
    state=json.loads(STATE.read_text())
    rows=scan(state)
    apply(state,rows)
    snapshot=json.dumps(state,ensure_ascii=False,indent=2)+'\n'
    if args.replay_check:
        apply(state,rows)
        assert snapshot==json.dumps(state,ensure_ascii=False,indent=2)+'\n','重复运行改变了总账'
    if not args.ingest_only:render(state['events'])
    STATE.write_text(snapshot)
