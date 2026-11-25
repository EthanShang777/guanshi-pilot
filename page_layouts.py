"""Editorial and directory layouts for both fresh builds and published snapshots."""
import json
import re
import shutil
from html import escape
from collections import defaultdict
from update import link


def publish(out, deals):
    records = out/'records'
    events = {d['href']: d for d in deals}
    lookup = {}
    for path in records.glob('institution-??.json'):
        for key, row in json.loads(path.read_text()).items():
            case = row['events'][0]
            lookup[key] = [row['name'], len(row['events']), case[1], case[6] or case[5], case[0], case[2]]
    (records/'institution-names.json').write_text(json.dumps([[v[0], k] for k,v in lookup.items()],ensure_ascii=False))
    for asset in ('atlas.js','company-browser.js','master-search.js','directory-search.js'):
        shutil.copyfile(asset,out/asset)
    def write(path, text):
        path.write_text(text)
    for path in out.glob('index*.html'):
        html = path.read_text()
        if 'class="financing-feed"' not in html: continue
        def item(m):
            d=events[m[1]]
            def party(pair):
                name,url=pair
                from urllib.parse import urlencode
                params=urlencode({k:v for k,v in [('sector',d['sector']),('sub',d['sub'])] if v})
                return link(url+('&'+params if params else ''),name)
            parties=list(map(party,d['parties']))
            investors='、'.join(parties[:2]) or '—'
            if len(parties)>2:
                investors+='<details><summary>另 '+str(len(parties)-2)+' 家</summary>'+'、'.join(parties[2:])+'</details>'
            sector=d['sub'] or d['sector']
            subtitle='<small>'+escape(sector)+'</small>' if sector and sector!='待归类' else ''
            def field(label,value):
                return '<span class="trade-field"><small>'+label+'</small>'+value+'</span>'
            return ('<li class="feed-line trade-row"><div>'+link(d['href'],d['company'])+subtitle+'</div>'+
                    field('轮次 / 类型',escape(d['stage'] or '—'))+field('披露金额',escape(d['amount'] or '—'))+
                    '<div class="trade-parties"><small>投资方</small>'+investors+'</div></li>')
        html=re.sub(r'<li(?: class="feed-line(?: trade-row)?")?><div><a href="(deal\.html\?id=[\da-f]+)">.*?</li>',item,html,flags=re.S)
        headings='<div class="trade-head" aria-hidden="true"><span>日期</span><div><span>公司 / 业务方向</span><span>轮次 / 类型</span><span>披露金额</span><span>投资方</span></div></div>'
        if 'class="trade-head"' not in html:
            html=html.replace('<div class="financing-feed">','<div class="financing-feed">'+headings)
        header=re.search(r'<p class="search-entry">.*?</p>',html)
        if header and header.start()>html.index('</header>',html.index('<main>')):
            html=html.replace(header[0],'').replace('</h1>','</h1>'+header[0],1)
        write(path,html)
    for path in out.glob('institutions*.html'):
        html=path.read_text()
        def institution(m):
            key=m[1]
            if key not in lookup:return m[0]
            name,n,company,sector,url,day=lookup[key]
            return ('<div class="inst-line">'+link('institution.html?id='+key,name)+'<span>'+escape(sector or '')+'</span>'+
                    link(url,company+' · '+(day or '日期未列明'))+f'<small>{n} 笔</small></div>')
        html,n=re.subn(r'<div class="directory-row"><a href="institution\.html\?id=([a-f0-9]+)">.*?</div>',institution,html)
        html, existing = re.subn(r'<div class="inst-line"><a href="institution\.html\?id=([a-f0-9]+)">.*?</div>',institution,html)
        if existing and not n:
            write(path,html)
        if n:
            tools='<form class="inst-search"><input type="search" required aria-label="机构名称" placeholder="搜索全部机构"><button>搜索</button></form><div id="inst-hits" aria-live="polite"></div><script defer src="directory-search.js"></script>'
            html=html.replace('</header><div id="local-find"', '</header>'+tools+'<div id="local-find"',1)
            html=re.sub(r'(<nav>.*?</nav>)(?=<div class="inst-line">)',lambda m:'' if '<header' not in m[0] and 'aria-label' not in m[0] else m[0],html, count=1)
            write(path,html)
    path=out/'reports.html';html=path.read_text()
    def edition(m):
        date,body=m.groups()
        entries=re.findall(r'<a href="(report-[^"]+)">(.*?)</a>',body)
        if not entries:return m[0]
        lead=next((v for v in entries if 'embodied-intelligence' in v[0]),entries[0])
        report=(out/lead[0]).read_text()
        paragraph=re.search(r'<p class="reading-lead">(.*?)</p>',report,re.S)
        return ('<section class="edition"><header><small>'+date+' · 本期主读</small><h2>'+link(lead[0],lead[1])+'</h2>'+
                ('<p>'+paragraph[1]+'</p>' if paragraph else '')+'</header><div><h3>同一期研究</h3>'+
                ''.join('<p>'+link(url,title)+'</p>' for url,title in entries if url!=lead[0])+'</div></section>')
    if 'class="edition"' not in html:
        html=re.sub(r'<section class="profile-records"><h2>(.*?)</h2>(.*?)</section>',edition,html,count=1,flags=re.S)
        write(path,html.replace('<div class="profile-directory">','<div class="topic-strip">',1))
    path=out/'changes.html';html=path.read_text()
    pattern=r'<article class="deal"><h3>(.*?)</h3><small>(.*?)</small><p class="review-result">(.*?)</p>(.*?)<details class="research-node"><summary>(.*?)</summary>(.*?)</details></article>'
    seen=defaultdict(list)
    def revision(m):
        title,date,result,sources,label,details=m.groups()
        question=re.search(r'<dt>跟踪问题</dt><dd>(.*?)</dd>',details)
        key=question[1] if question else title
        anchor='revision-'+str(m.start())
        seen[key].append((anchor,date))
        return f'<article class="revision" id="{anchor}"><small>{date}</small><div><h3>{result}</h3>{sources}<details><summary>原问题与验证条件</summary><p>{title}</p>{details}</details><!--{anchor}--></div></article>'
    html=re.sub(pattern,revision,html,flags=re.S)
    for group in seen.values():
        for i,(anchor,_) in enumerate(group[:-1]):
            target,day=group[i+1]
            html=html.replace('<!--'+anchor+'-->',link('#'+target,'上次复核 · '+day))
    write(path,html)
    for name in ('index','search','institutions','reports','changes'):
        path=out/(name+'.html');html=path.read_text()
        if 'class="page-find"' in html: continue
        html=re.sub(r'(<div id="local-find".*?</div>)',r'<details class="page-find"><summary>页内查找</summary>\1</details>',html,count=1,flags=re.S)
        write(path,html)
