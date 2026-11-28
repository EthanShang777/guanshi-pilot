"""Build independently loadable public graph neighbourhoods and directory pages."""
import json
from collections import defaultdict
from html import escape
from pathlib import Path
from unicodedata import normalize
from urllib.parse import urlencode

from sector_taxonomy import BRANCHES, classify_sector


OUTPUT = Path('atlas')
DIRECTORY_SIZE = 120
ROOT_EDGE_LIMIT = 4
ROLES = ('融资赛道', '子赛道', '业务方向', '研究方向', '细分方向', '公司', '机构', '基金', '融资', '周报', '研究事件', '研究主体')


def directory_key(name):
    return normalize('NFKC', name).lower()


def write_directory(directory, file, nodes):
    roles = defaultdict(list)
    for ident, node in nodes.items():
        roles[node['role']].append([ident, node['name'], node['url'], len(node['edges'])])
    manifest = []
    part = 0
    for role in ROLES:
        items = roles.get(role, [])
        if not items:
            continue
        # Use the same UTF-16 sort order as JavaScript's string comparisons.
        items.sort(key=lambda item: (directory_key(item[1]).encode('utf-16-be'), item[0]))
        ranges = []
        for start in range(0, len(items), DIRECTORY_SIZE):
            block = items[start:start+DIRECTORY_SIZE]
            (directory/f'{file}.list-{part}').write_text(json.dumps(block, ensure_ascii=False, separators=(',', ':')))
            ranges.append([part, directory_key(block[0][1]), directory_key(block[-1][1]), len(block)])
            part += 1
        manifest.append([role, ranges])
    (directory/f'{file}.directory').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
    return manifest


def build_atlas(rows, reports, live, filename, topics, subject, archives, event_url, fund_ids):
    directory = OUTPUT
    directory.mkdir(exist_ok=True)
    catalog = []
    full_directory = defaultdict(list)
    live_by_company = {e['company'] for e in live}
    live_by_investor = {name for e in live for name in e['investors']}

    def dump(file, value):
        (directory/file).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')))

    def write_group(title, kind, key, scope, root_url, populate):
        nodes = {}
        seen = set()

        def node(role, name, url='', identity=None, summary=''):
            ident = role+'|'+(identity or name)
            nodes.setdefault(ident, dict(name=name, role=role, url=url, summary=summary, edges=[]))
            return ident

        def edge(a, b, verb, reverse, route='', source_label=''):
            for src, dst, label in [(a,b,verb),(b,a,reverse)]:
                if (src,dst,label) in seen:
                    continue
                seen.add((src,dst,label))
                entry = [dst, label]
                if route:
                    entry.extend([route, source_label])
                nodes[src]['edges'].append(entry)

        stats = defaultdict(lambda: (set(), set()))

        def count(ident, company, deal):
            companies, deals = stats[ident]
            companies.add(company)
            deals.add(deal)

        root = node(kind, title, root_url)
        populate(root, node, edge, count)
        for ident, (companies, deals) in stats.items():
            nodes[ident]['summary'] = f'{len(companies)} 家公司 · {len(deals)} 笔融资'
        file = filename('graph',key).replace('.html','.json')
        for role, ranges in write_directory(directory, file, nodes):
            full_directory[role].extend([*bounds, file] for bounds in ranges)
        opening_edges = nodes[root]['edges'][:ROOT_EDGE_LIMIT]
        opening = {root: nodes[root] | {'edges': opening_edges, 'edgeCount': len(nodes[root]['edges'])}}
        opening.update((ident, {key: v for key, v in nodes[ident].items() if key != 'edges'}) for ident, *_ in opening_edges)
        dump(file+'.root', opening)
        for node_index, n in enumerate(nodes.values()):
            edges = n['edges']
            if len(edges) <= 40:
                continue
            n.update(edgeCount=len(edges), edgeFile=f'{file}.edges-{node_index}')
            for i in range(0, len(edges), 40):
                dump(f'{n["edgeFile"]}-{i // 40}', edges[i:i+40])
            n['edges'] = []
        if len(nodes)>500:
            chunks=defaultdict(dict)
            for ident,n in nodes.items():
                chunks[sum(map(ord,ident))%64][ident]=n
            for bucket,items in chunks.items():
                dump(f'{file}.{bucket}', items)
            dump(file, {'sharded': True, 'buckets': sorted(chunks)})
        else:
            dump(file, nodes)
        catalog.append((title, file, root, scope))

    groups = defaultdict(list)
    for row in rows:
        if 'sectorId' not in row:
            category = classify_sector(row['sector'], row.get('sub'))
            row = row | {'sector': category.name, 'sectorId': category.id, 'sub': category.direction,
                         'subId': category.direction_id, 'sectorBranches': category.branches}
        groups[row['sectorId']].append(row)
    for sector_id, items in sorted(groups.items(), key=lambda pair: (pair[0]!='chips-computing', pair[1][0]['sector'])):
        sector = items[0]['sector']
        root_url = 'search.html?'+urlencode({'sector': sector_id})

        def financing(root, node, edge, count):
            for r in items:
                name = r['company']
                href = r.get('companyHref') or (filename('company',name) if name in live_by_company else '')
                company = node('公司', name, href, href)
                date = r['day'] or '日期未列明'
                label = r['stage'] or '轮次未列明'
                archive = r['href']
                deal = node('融资', f'{name} · {date} · {label}', archive, archive,
                            r.get('dateKind') or r.get('date_kind') or '')
                count(root, company, deal)
                parent_nodes = []
                for branch_id in r['sectorBranches']:
                    url = 'search.html?'+urlencode({'sector': sector_id, 'sub': branch_id})
                    branch = node('子赛道', BRANCHES[branch_id], url, branch_id)
                    edge(root, branch, '子赛道', '上级赛道', url, '查看分类记录')
                    count(branch, company, deal)
                    parent_nodes.append(branch)
                parent_nodes = parent_nodes or [root]
                business = r.get('sub')
                if business and business not in [BRANCHES[branch] for branch in r['sectorBranches']]:
                    url = 'search.html?'+urlencode({'sector': sector_id, 'sub': r.get('subId') or business})
                    direction = node('业务方向', business, url, r.get('subId'))
                    for parent in parent_nodes:
                        edge(parent, direction, '业务方向', '所属赛道', url, '查看分类记录')
                    count(direction, company, deal)
                    parent_nodes = [direction]
                has_sources = bool(r.get('sources') or r.get('source'))
                archive_label = '查看融资档案与来源' if has_sources else '查看融资档案'
                for parent in parent_nodes:
                    edge(parent, company, '归类公司', '档案归类', archive, '查看归类档案')
                edge(company, deal, '融资档案', '融资主体', archive, archive_label)
                parties = dict(r.get('parties', ()))
                for name in r['investors']:
                    href = parties.get(name) or (filename('institution',name) if name in live_by_investor else '')
                    role = '基金' if href.removeprefix('institution.html?id=') in fund_ids else '机构'
                    investor = node(role, name, href, href)
                    edge(deal, investor, '档案所列资方', '档案所列交易', archive, archive_label)
                for rid in r.get('reports', ()):
                    if rid in reports:
                        url = 'report-'+rid+'.html'
                        report = node('周报', reports[rid]['title'], url, rid)
                        edge(deal, report, '关联周报', '关联融资档案', url, '查看周报与来源')

        write_group(sector, '融资赛道', 'sector-'+sector, sector_id, root_url, financing)
    for topic, title in topics.items():
        topic_url = 'landscape-'+topic+'.html'

        def research(root, node, edge, count):
            for rid,r in reports.items():
                if r['topic'] != topic:
                    continue
                for item in r['events']:
                    branch = node('细分方向', subject(topic,item))
                    url = event_url(rid, item)
                    evidence = node('研究事件', item['title'], url, url)
                    edge(root, branch, '细分方向', '研究方向', topic_url, '查看研究目录')
                    edge(branch, evidence, '周报列入的事件', '周报归类', url, '查看报告证据')
                    report = node('周报', r['title'], 'report-'+rid+'.html', rid)
                    edge(evidence, report, '收录周报', '周报列入的事件', url, '查看报告证据')
                    links = archives(item['company'])
                    for name, spec in links:
                        role, href = spec or ('研究主体', '')
                        entity = node(role, name, href, href)
                        edge(evidence, entity, '周报提及', '周报提及该对象', url, '查看报告证据')

        write_group(title, '研究方向', 'topic-'+topic, topic, topic_url, research)
    dump('directory.json', [(role, full_directory[role]) for role in ROLES if full_directory[role]])
    options = ''.join(f'<option value="{file}" data-root="{escape(root,quote=True)}" data-scope="{scope}">{escape(title)}</option>'
                      for title, file, root, scope in catalog)
    options += '<option value="directory.json" data-scope="all">全部范围</option>'
    graph = ('<div id="atlas-graph"><div class="atlas-controls">'
             '<button id="atlas-back" type="button" disabled>返回上层</button>'
             '<button id="atlas-minus" type="button" aria-label="缩小">−</button>'
             '<button id="atlas-plus" type="button" aria-label="放大">＋</button>'
             '<button id="atlas-center" type="button">居中</button></div>'
             '<div class="atlas-graph-grid"><div id="atlas-view" aria-label="局部关系图"><div id="atlas-world"></div></div>'
             '<aside id="atlas-brief" aria-label="关系与依据"></aside></div>'
             '<div class="atlas-pager" id="atlas-graph-pager" hidden><button type="button" id="atlas-graph-prev">上一组</button>'
             '<span id="atlas-graph-count"></span><button type="button" id="atlas-graph-next">下一组</button></div></div>')
    listing = ('<section id="atlas-directory" aria-label="关系列表" hidden><div class="atlas-table-wrap"><table class="atlas-table">'
               '<thead><tr><th scope="col">名称</th><th scope="col">类型</th><th scope="col">关系数</th><th scope="col">操作</th></tr></thead>'
               '<tbody id="atlas-items"></tbody></table></div><div class="atlas-pager" hidden><button type="button" id="atlas-prev">上一页</button>'
               '<span id="atlas-count"></span><button type="button" id="atlas-next">下一页</button></div></section>')
    return ('<link rel="stylesheet" href="atlas.css?v=workbench1"><section id="atlas">'
            '<form class="atlas-tools"><label>范围<select id="atlas-scope">'+options+'</select></label>'
            '<label>对象类型<select id="atlas-role"><option value="">全部对象</option></select></label>'
            '<label>名称<input id="atlas-query" type="search" maxlength="120" placeholder="输入名称开头"></label><button>搜索</button>'
            '</form><div class="atlas-bar"><div class="atlas-toggle" role="group" aria-label="显示方式">'
            '<button type="button" id="atlas-show-graph" aria-pressed="true">关系图</button>'
            '<button type="button" id="atlas-show-list" aria-pressed="false">关系列表</button></div>'
            '<output id="atlas-status" aria-live="polite"></output><button id="atlas-retry" type="button" hidden>重试</button></div>'
            '<noscript>此页需要 JavaScript。可继续使用 <a href="search.html">融资检索</a> 或 <a href="reports.html">研究周报</a>。</noscript>'
            +graph+listing+'</section><script defer src="atlas.js?v=workbench1"></script>')
