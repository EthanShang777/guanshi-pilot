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
COMPANY = re.compile(r'^(.{1,36}?)(?:宣布完成|宣布获得|已完成|完成|获得|获)')
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
    names = []
    pattern = r'(?:由|，)([^，。；]{1,100}?)(?:联合领投|联合投资|共同投资|领投|跟投|投资)(?=[，。；\s]|$)'
    for group in re.findall(pattern,body):
        group = group.removeprefix('由')
        group = re.sub(r'（简称[“"].*?[”"]）','',group)
        for name in re.split(r'、|以及|和(?=[^）]*(?:（|$))',group):
            if name not in {'产业资本','产业投资方','机构投资者','老股东'} and re.fullmatch(r'[\w·（）/－-]{2,30}',name) and not re.search(r'多家|本轮|本次|公司宣布|包括|等|担任',name):
                names.append(name)
    return list(dict.fromkeys(names))

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
            if url not in existing["sources"]:
                existing["sources"].append(url)
                linked += 1
            existing["investors"] = list(dict.fromkeys(existing["investors"]+parties))
        else:
            events.append(dict(id=path.split('-')[-1][:-5],day=day,company=company,title=title,
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
    css = Path('site.css').read_text()
    def page(path,title,section,content):
        nav=''.join(link(url,label) for url,label in [('index.html','融资事件'),('companies.html','公司档案'),('institutions.html','机构档案')])
        nav=nav.replace('<a ','<a class="topic-button" ')
        Path(path).write_text(f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{html.escape(title)} · 观势</title><style>{css}\n.report-card{{margin:16px 0}}.card-bottom{{gap:12px}}</style><body><aside class="sidebar"><a class="brand" href="index.html"><span class="brandmark">观</span>观势</a><nav>{nav}</nav></aside><main><header class="topbar"><div><span class="eyebrow">{section}</span><h1>{html.escape(title)}</h1></div></header>{content}</main></body></html>')
    def card(e):
        return '<article class="report-card"><small>投中网披露 · '+e['day']+'</small><h3>'+link(event_url(e),e['title'])+'</h3></article>'
    ordered=sorted(events,key=lambda e:(e['day'],e['id']),reverse=True)
    page('index.html','融资时间线','融资事件',''.join(map(card,ordered)))
    for e in ordered:
        company=link(filename('company',e['company']),e['company'])
        parties='、'.join(link(filename('institution',n),n) for n in e['investors'])
        note = '本次披露金额为 B 轮首次交割金额。' if e.get('first_close') else ''
        if e['id']=='seed': note='独家财务顾问为微纳资本。资金用于推进核心管线临床试验和研究者发起的临床研究。'
        sources=' · '.join(link(u,'投中网原文' if i==0 else '相关披露') for i,u in enumerate(e['sources']))
        page(event_url(e),e['title'],'融资详情',f'<article class="report-card"><small>披露于 {e["day"]}</small><p>融资公司　{company}</p><p>已识别投资方　{parties or "见原文"}</p><p>{note}</p><div class="card-bottom">{sources}</div></article>')
    for kind,label,index in [('company','公司档案','companies.html'),('institution','机构档案','institutions.html')]:
        groups={}
        for e in ordered:
            for name in ([e['company']] if kind=='company' else e['investors']):
                groups.setdefault(name,[]).append(e)
        page(index,label,'观势',''.join('<article class="report-card">'+link(filename(kind,n),n)+'</article>' for n in groups))
        for name,items in groups.items():
            desc={'三有利康':'北京三有利康细胞科技有限公司成立于 2021 年，研发精准亚型间充质干细胞药物。','烟台生命岛':'投中网披露的三有利康 Pre-A 轮投资方。'}.get(name,'')
            page(filename(kind,name),name,label,'<p>'+desc+'</p>'+''.join(map(card,items)))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--replay-check',action='store_true')
    args=parser.parse_args()
    state=json.loads(STATE.read_text())
    rows=scan(state)
    apply(state,rows)
    snapshot=json.dumps(state,ensure_ascii=False,indent=2)+'\n'
    if args.replay_check:
        apply(state,rows)
        assert snapshot==json.dumps(state,ensure_ascii=False,indent=2)+'\n','重复运行改变了总账'
    render(state['events'])
    STATE.write_text(snapshot)
