from collections import defaultdict
from hashlib import sha256
from pathlib import Path
import json
import shutil


def publish(out, deals):
    data = out/'records'
    from financing_feed import publish as publish_feed
    deals = list(deals)
    publish_feed(out, deals)
    groups = defaultdict(dict)
    for d in sorted(deals, key=lambda r: r['day'] or '', reverse=True):
        if d['sub']:
            groups[(d['sector'],d['sub'])].setdefault(d['companyHref'], [
                d['companyHref'], d['company'], d['day'], d['stage'], d['amount'], d['href']])
    topics = {}
    for (sector,sub), peers in groups.items():
        key = sha256((sector+'\n'+sub).encode()).hexdigest()[:20]
        topics.setdefault(sector,{})[sub] = key
        (data/f'peers-{key}.json').write_text(json.dumps(list(peers.values())[:6],ensure_ascii=False))
    (data/'research-topics.json').write_text(json.dumps(topics,ensure_ascii=False))
    for asset in ('company-research.css','company-research.js','palette.css'):
        shutil.copyfile(asset,out/asset)
    shell = (out/'search.html').read_text()
    head, rest = shell.split('<main>',1)
    head = head.replace('融资交叉检索 · 观势','公司研究台 · 观势').replace(' aria-current="location"', '')
    (out/'company-research.html').write_text(head+Path('company-research-body.html').read_text()+'</html>')
    from page_layouts import publish as publish_layouts
    publish_layouts(out,deals)
    for path in out.glob('*.html'):
        html = path.read_text()
        marker = '<nav aria-label="栏目">'
        if marker in html and 'href="company-research.html"' not in html:
            current = ' aria-current="page"' if path.name=='company-research.html' else ''
            html = html.replace(marker,marker+f'<a href="company-research.html"{current}>公司研究台</a>',1)
        if marker in html:
            import re
            html = re.sub(r'<section class="arc">.*?</section>', '',html,flags=re.S)
            html = re.sub(r'<div data-shelf="[^"]*"></div>|<script src="(?:load-)?shelf.js"></script>', '',html)
            html = re.sub(r'<link rel="stylesheet" href="palette\.css[^"]*">','',html)
            stylesheet = '<link rel="stylesheet" href="palette.css?v=trade4">'
            # Page-specific styles may appear inside main; load the common palette after them.
            path.write_text(html.replace('</html>',stylesheet+'</html>',1))
