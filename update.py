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
    from itertools import groupby

    css = Path('site.css').read_text()
    nav_items = [('index.html','融资事件'), ('companies.html','公司档案'), ('institutions.html','机构档案')]

    def page(path, title, section, content, *, meta='', cover=False):
        nav = ''.join(
            f'<a href="{url}"' + (' aria-current="location"' if label == section else '') + f'>{label}</a>'
            for url,label in nav_items
        )
        engraving = ''.join(f'<i style="--n:{n}"></i>' for n in range(14))
        art = f'<div class="engraving" aria-hidden="true">{engraving}</div>' if cover else ''
        caption = f'<p>{html.escape(meta)}</p>' if meta else ''
        Path(path).write_text(f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} · 观势</title><style>{css}</style></head>
<body><header class="top"><a class="brand" href="index.html"><span class="mark" aria-hidden="true">观</span>观势</a>
<nav aria-label="栏目">{nav}</nav></header>
<main><header class="hero {'cover' if cover else ''}">{caption}<h1>{html.escape(title)}</h1>{art}</header>
{content}</main></body></html>''')

    def timeline(items):
        sections = []
        for day, entries in groupby(items, key=lambda e:e['day']):
            stamp = date.fromisoformat(day)
            rows = ''.join('<article class="entry"><h3>'+link(event_url(e),e['title'])+'</h3></article>' for e in entries)
            sections.append(f'<section class="day"><h2><time datetime="{day}"><small>{stamp.year}</small>{stamp:%m.%d}</time></h2><div>{rows}</div></section>')
        return ''.join(sections)

    ordered = sorted(events,key=lambda e:(e['day'],e['id']),reverse=True)
    page('index.html','融资时间线','融资事件',timeline(ordered),cover=True)
    for e in ordered:
        fields = [('融资公司',link(filename('company',e['company']),e['company'])),
                  ('投资方','、'.join(link(filename('institution',n),n) for n in e['investors']) or '见原文')]
        if e.get('first_close'):
            fields.append(('金额口径','本次披露金额为本轮首次交割金额。'))
        if e['id']=='seed':
            fields.append(('融资用途','资金用于推进核心管线临床试验和研究者发起的临床研究。'))
            fields.append(('财务顾问','微纳资本（独家）'))
        fields.append(('资料来源',' · '.join(link(u,'投中网原文' if i==0 else '相关披露') for i,u in enumerate(e['sources']))))
        facts = ''.join(f'<div><dt>{label}</dt><dd>{value}</dd></div>' for label,value in fields)
        page(event_url(e),e['title'],'融资事件','<dl class="details">'+facts+'</dl>',meta=e['day']+'  投中网披露')

    for kind,label,index in [('company','公司档案','companies.html'),('institution','机构档案','institutions.html')]:
        groups = {}
        for e in ordered:
            for name in ([e['company']] if kind=='company' else e['investors']):
                groups.setdefault(name,[]).append(e)
        directory = ''.join(link(filename(kind,n),n) for n in groups)
        page(index,label,label,'<div class="directory">'+directory+'</div>',cover=True)
        for name,items in groups.items():
            desc = {'三有利康':'北京三有利康细胞科技有限公司成立于 2021 年，研发精准亚型间充质干细胞药物。',
                    '烟台生命岛':'投中网披露的三有利康 Pre-A 轮投资方。'}.get(name,'')
            intro = '<p class="intro">'+desc+'</p>' if desc else ''
            page(filename(kind,name),name,label,intro+timeline(items),meta=label)

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
