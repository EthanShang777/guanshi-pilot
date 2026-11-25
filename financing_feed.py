from itertools import groupby
from html import escape
from pathlib import Path
import re
from update import link


def publish(out, deals):
    rows = sorted(deals, key=lambda d: d['day'] or '', reverse=True)
    # The existing timelines own their ordering and pagination, including ties.
    by_href = {d['href']: d for d in rows}
    for path in out.glob('index*.html'):
        if not re.fullmatch(r'index(?:-\d+)?\.html', path.name):
            continue
        html = path.read_text()
        table = re.search(r'<div class="finance-scroll".*?</table></div>', html, re.S)
        if not table:
            continue
        urls = re.findall(r'<th scope="row"><a href="([^"]+)"', table[0])
        if not urls or any(url not in by_href for url in urls):
            raise ValueError(f'Unmatched timeline links in {path.name}')
        groups = []
        for day, events in groupby((by_href[u] for u in urls), key=lambda d:d['day']):
            items = []
            for d in events:
                terms = ' · '.join(filter(None, [d['stage'], d['amount']]))
                sector = d['sub'] or d['sector']
                parties = '、'.join(d['investors'])
                detail = '　·　'.join(filter(None,[sector,'投资方　'+parties if parties else '']))
                items.append('<li><div>'+link(d['href'],d['company'])+'<b>'+escape(terms)+'</b></div><small>'+escape(detail)+'</small></li>')
            groups.append('<section class="feed-day"><h2>'+escape(day or '日期未列明')+'</h2><ul>'+''.join(items)+'</ul></section>')
        before = re.sub(r'<nav>[^<]*(?:<a [^>]+>[^<]*</a>[^<]*)*</nav>\s*$', '',html[:table.start()])
        path.write_text(before+'<div class="financing-feed">'+''.join(groups)+'</div>'+html[table.end():])
