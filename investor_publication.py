"""Shared navigation and private workbench shells for the public Pages artifact."""
from html import escape
from pathlib import Path
import re
import shutil


NAV = (
    ('index.html', '工作台', 'home'), ('discover.html', '发现与检索', 'discover'),
    ('companies.html', '公司', 'companies'), ('institutions.html', '机构与基金', 'institutions'),
    ('research.html', '研究', 'research'), ('projects.html', '我的项目', 'projects'),
)
THEME = '<link rel="stylesheet" href="investor-theme.css?v=1">'
HEADER = re.compile(r'<header class="top"[^>]*>.*?</header>', re.S)
WORKBENCH = '<section id="investor-workbench"'
ASSETS = ('investor-theme.css', 'investor-workbench.js', 'investor-lookup.js', 'investor-actions.js',
          'investor-compare.js', 'investor-compare.css', 'report-reader.css')


def area_for(path):
    if path == 'index.html':
        return 'home'
    if path.startswith(('institutions', 'institution')):
        return 'institutions'
    if path in ('workspace.html', 'projects.html'):
        return 'projects'
    if path.startswith(('report', 'landscape', 'research', 'company-research')) or path in (
            'compare.html', 'judgments.html', 'changes.html'):
        return 'research'
    if path.startswith(('company', 'companies')):
        return 'companies'
    return 'discover'


def header(area):
    nav = ''.join(f'<a href="{path}"' + (' aria-current="page"' if role == area else '') +
                  f'>{label}</a>' for path, label, role in NAV)
    return ('<header class="top" data-investor-shell="1"><a class="brand" href="index.html" aria-label="观势工作台">观势</a>'
            f'<nav aria-label="主要栏目">{nav}</nav>'
            '<form class="site-lookup" action="lookup.html" method="get" role="search">'
            '<label for="site-query" class="sr-only">搜索公司或机构</label>'
            '<input id="site-query" name="q" type="search" placeholder="公司或机构" required maxlength="120">'
            '<button type="submit">搜索</button></form></header>')


def script(name):
    return f'<script defer src="{name}?v=1"></script>'


def route_assets(path, html):
    interactive = {
        'index.html','lookup.html','compare.html','changes.html','judgments.html','companies.html',
        'company.html','institution.html','projects.html','search.html','workspace.html',
    }
    if path not in interactive:
        return ''
    assets = ''
    if path != 'changes.html' and 'src="fa-store.js' not in html:
        assets += '<script defer src="fa-store.js?v=2"></script>'
    if path in ('companies.html','company.html','search.html','workspace.html','compare.html','lookup.html'):
        assets += '<link rel="stylesheet" href="investor-compare.css?v=1">' + script('investor-compare.js')
    if path in ('index.html','judgments.html','changes.html'):
        assets += '<link rel="stylesheet" href="investor-evidence.css?v=1">' + script('investor-evidence.js')
    if path in ('index.html','company.html','institution.html','projects.html'):
        assets += script('investor-actions.js')
    leaf = {'index.html':'investor-workbench.js','lookup.html':'investor-lookup.js','judgments.html':'investor-judgments.js'}.get(path)
    return assets + (script(leaf) if leaf else '')


def restore_timeline(out):
    index = out / 'index.html'
    old = index.read_text()
    if WORKBENCH in old:
        timeline = (out / 'discover.html').read_text()
        index.write_text(timeline)


def publish_workspace(out, page):
    for asset in ASSETS:
        shutil.copyfile(asset,out / asset)
    timeline = (out / 'index.html').read_text()
    if WORKBENCH not in timeline:
        (out / 'discover.html').write_text(timeline)
    (out / 'records' / 'investor-sectors.json').write_text(_sector_json())
    page('index.html','工作台','工作台',Path('investor-workbench.html').read_text(),with_find=False)
    page('lookup.html','查找公司与机构','发现与检索','<section id="investor-lookup" aria-label="搜索结果"></section>',with_find=False)
    page('compare.html','公司比较','研究','<section id="investor-compare" aria-label="公司比较"></section>',with_find=False)
    page('judgments.html','研究判断','研究','<section id="investor-judgments" aria-label="我的研究判断"></section>',with_find=False)
    links = (
        ('company-research.html','公司研究台','打开公司已有研究、资料缺口和证据。'),
        ('compare.html','公司比较','选取多家公司，按统一字段比较和保存。'),
        ('reports.html','研究周报','查看历期判断、覆盖区间与来源。'),
        ('landscape.html','赛道画布','从关系图或列表定位公司、机构与融资依据。'),
        ('changes.html','变化追踪','回看公开证据变化和历期研究复核。'),
        ('judgments.html','我的研究判断','保存待核问题、原有判断与下一步。'),
    )
    page('research.html','研究','研究','<div class="research-index">'+''.join(
        f'<article><h2><a href="{path}">{escape(title)}</a></h2><p>{escape(blurb)}</p></article>'
        for path,title,blurb in links)+'</div>',with_find=False)
    changes = out / 'changes.html'
    html = changes.read_text()
    if 'id="investor-evidence"' not in html:
        anchor = html.find('<div class="report-reader"')
        if anchor < 0:
            anchor = html.index('</main>')
        html = html[:anchor]+'<section id="investor-evidence" aria-label="公开证据变动"></section>'+html[anchor:]
        changes.write_text(html)
    for path in out.glob('*.html'):
        html = path.read_text()
        if not HEADER.search(html):
            continue
        area = area_for(path.name)
        html = re.sub(r'<div data-investor-assets="1" hidden>.*?</div>', '', html, count=1, flags=re.S)
        html = html.replace(THEME,'')
        html = re.sub(r'fa-store\.js\?v=\w+', 'fa-store.js?v=2', html)
        html = re.sub(r'src="(master-search|master-detail|company-browser)\.js(?:\?v=[^"]+)?"',
                      r'src="\1.js?v=investor1"', html)
        html = re.sub(r'href="palette\.css(?:\?v=[^"]+)?"', 'href="palette.css?v=investor1"', html)
        assets = route_assets(path.name,html)
        rebuilt = THEME + ('<div data-investor-assets="1" hidden>'+assets+'</div>' if assets else '') + header(area)
        html = HEADER.sub(lambda _: rebuilt,html,count=1)
        if re.fullmatch(r'index-\d+\.html',path.name):
            html = html.replace('href="index.html">上一页','href="discover.html">上一页')
        if path.name == 'discover.html' and 'aria-label="发现工具"' not in html:
            html = html.replace('</h1>', '</h1><nav class="task-links" aria-label="发现工具"><a href="search.html">融资交叉检索</a><a href="lookup.html">查找公司和机构</a></nav>',1)
        path.write_text(html)


def _sector_json():
    import json
    from sector_taxonomy import ROOTS

    return json.dumps([{'id':key,'name':label} for key,label in ROOTS.items() if key != 'unknown'],
                      ensure_ascii=False,separators=(',',':'))
