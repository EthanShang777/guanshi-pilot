from collections import defaultdict
from hashlib import sha256
from html import escape
from pathlib import Path
from urllib.parse import urlsplit
import json
import shutil

from institution_identity import REVIEWED_ALIASES


RESEARCH_SECTIONS = {
    '市场规模': '市场规模',
    '市场痛点': '市场痛点',
    '核心团队': '核心团队',
    '核心技术/产品': '核心技术与产品',
    '友商对比': '友商对比',
    '历史融资情况': '历史融资与历史资方',
    '机构类似布局': '机构类似布局',
    '新增潜在机构': '新增潜在机构',
}
NON_FINANCING = {'股权转让', '介绍上市', '拟增资'}


def render_sample(sample):
    modules = {module['section']: module for module in sample['modules']}
    if len(modules) != len(sample['modules']) or modules.keys() != RESEARCH_SECTIONS.keys():
        raise ValueError('The research sample must include each research section once')
    cards = []
    for section, title in RESEARCH_SECTIONS.items():
        module = modules[section]
        parts = [f'<article><h3>{escape(title)}</h3>']
        for fact in module.get('facts', []):
            sources = []
            for source in fact['sources']:
                url = urlsplit(source['url'])
                if url.scheme != 'https' or not url.hostname:
                    raise ValueError('Research sample evidence requires a secure source URL')
                label = ' · '.join(filter(None, (source['title'], source.get('date'))))
                sources.append(f'<a href="{escape(source["url"], quote=True)}">{escape(label)}</a>')
            if not sources:
                raise ValueError('Research sample facts require sources')
            parts.append(f'<p>{escape(fact["text"])}</p><small>{" · ".join(sources)}</small>')
        if assessment := module.get('assessment'):
            parts.append(f'<p class="research-review"><strong>分析判断</strong> {escape(assessment)}</p>')
        if follow_on := module.get('followOn'):
            parts.append(f'<p><strong>老股东追加</strong> {escape(follow_on)}</p>')
        parts.append(f'<p class="research-gap"><strong>证据缺口</strong> {escape(module["gap"])}</p></article>')
        cards.append(''.join(parts))
    questions = ''.join(f'<li>{escape(q)}</li>' for q in sample.get('questions', []))
    question_list = f'<h3>约谈先问</h3><ul>{questions}</ul>' if questions else ''
    return (f'<section id="api-study" data-company="{escape(sample["company"], quote=True)}" hidden>'
            f'<small>研究样本 · {escape(sample["asOf"])}</small><div class="api-cards">'
            + ''.join(cards) + '</div>' + question_list + '</section>')


def research_topics(deals):
    groups = defaultdict(dict)
    # A sourced financing with a named participant takes precedence for the same company.
    def case_order(deal):
        return bool(deal.get('sources') and deal['parties']), deal['day'] or ''

    for d in sorted(deals, key=case_order, reverse=True):
        if not d['sub'] or d['stage'] in NON_FINANCING:
            continue
        parties = d['parties'] if d.get('sources') else []
        groups[(d['sector'], d['sub'])].setdefault(d['companyHref'], [
            d['companyHref'], d['company'], d['day'], d['stage'], d['amount'], d['href'], parties,
        ])
    return groups


def render_page(search_page):
    head = search_page.split('<main>', 1)[0]
    head = head.replace('融资交叉检索 · 观势','公司研究台 · 观势').replace(' aria-current="location"', '')
    sections = escape(json.dumps(RESEARCH_SECTIONS, ensure_ascii=False), quote=True)
    names = {name: entry['aliases'] for name, entry in REVIEWED_ALIASES.items()}
    aliases = escape(json.dumps(names, ensure_ascii=False), quote=True)
    sample = json.loads(Path('research-api-sample.json').read_text())
    body = (Path('company-research-body.html').read_text()
            .replace('id="generated-study"', f'id="generated-study" data-sections="{sections}" data-institutions="{aliases}"')
            .replace('<div class="memo-grid">', render_sample(sample) + '<div class="memo-grid">'))
    return head + body + '</html>'


def publish(out, deals):
    data = out/'records'
    from financing_feed import publish as publish_feed
    deals = list(deals)
    publish_feed(out, deals)
    topics = {}
    for (sector,sub), peers in research_topics(deals).items():
        key = sha256((sector+'\n'+sub).encode()).hexdigest()[:20]
        topics.setdefault(sector,{})[sub] = key
        (data/f'peers-{key}.json').write_text(json.dumps(list(peers.values())[:6],ensure_ascii=False))
    (data/'research-topics.json').write_text(json.dumps(topics,ensure_ascii=False))
    for asset in ('company-research.css','company-research.js','palette.css'):
        shutil.copyfile(asset,out/asset)
    (out/'company-research.html').write_text(render_page((out/'search.html').read_text()))
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
