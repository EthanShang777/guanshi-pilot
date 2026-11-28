"""Build small, independently loadable public graph slices."""
import json
from collections import defaultdict
from pathlib import Path
from html import escape
from urllib.parse import urlencode

from sector_taxonomy import BRANCHES, classify_sector


OUTPUT = Path('atlas')

def build_atlas(rows, reports, live, filename, topics, subject):
    directory = OUTPUT
    directory.mkdir(exist_ok=True)
    catalog = []
    lookup = defaultdict(list)
    live_by_company = {e['company'] for e in live}
    live_by_investor = {name for e in live for name in e['investors']}

    def write_group(title, kind, key, populate):
        nodes = {}
        seen = set()
        def node(role, name, url='', identity=None):
            ident = role+'|'+(identity or name)
            nodes.setdefault(ident, dict(name=name, role=role, url=url, edges=[]))
            return ident
        def edge(a, b, verb, reverse):
            for src, dst, label in [(a,b,verb),(b,a,reverse)]:
                entry = [dst,label]
                if (src,dst,label) not in seen:
                    seen.add((src,dst,label))
                    nodes[src]['edges'].append(entry)
        stats = defaultdict(lambda: (set(), set()))
        def count(ident, company, deal):
            companies, deals = stats[ident]
            companies.add(company)
            deals.add(deal)
        root_url = 'search.html?'+urlencode({'sector': title}) if kind == '融资赛道' else ''
        root = node(kind,title,root_url)
        populate(root,node,edge,count)
        for ident, (companies, deals) in stats.items():
            nodes[ident]['summary']=f'{len(companies)} 家公司 · {len(deals)} 笔融资'
        file = filename('graph',key).replace('.html','.json')
        if len(nodes)>500:
            # Keep the overview and each neighbourhood load independent of sector size.
            chunks=defaultdict(dict)
            for ident,n in nodes.items():
                bucket=sum(map(ord,ident))%64
                chunks[bucket][ident]=n
            for bucket,items in chunks.items():
                (directory/(file+'.'+str(bucket))).write_text(json.dumps(items,ensure_ascii=False,separators=(',',':')))
            (directory/file).write_text(json.dumps({'sharded':True}))
        else:
            (directory/file).write_text(json.dumps(nodes,ensure_ascii=False,separators=(',',':')))
        catalog.append([title,file,root])
        for ident,n in nodes.items():
            lookup[n['name']].append([file,ident])
    groups = defaultdict(list)
    for row in rows:
        if 'sectorId' not in row:
            category = classify_sector(row['sector'], row.get('sub'))
            row = row | {'sector': category.name, 'sub': category.direction, 'sectorBranches': category.branches}
        groups[row['sector']].append(row)
    for sector,items in sorted(groups.items(),key=lambda pair:pair[0]!='芯片与算力'):
        def financing(root,node,edge,count):
            for r in items:
                name=r['company']
                company=node('公司',name,r.get('companyHref') or (filename('company',name) if name in live_by_company else ''),r.get('companyHref'))
                deal=node('融资',name+' · '+r['day']+' · '+(r['stage'] or '轮次未列明'),r['href'],r['href'])
                count(root,company,deal)
                parent_nodes = []
                for branch_id in r['sectorBranches']:
                    label = BRANCHES[branch_id]
                    url = 'search.html?'+urlencode({'sector': sector, 'sub': label})
                    branch = node('子赛道',label,url,branch_id)
                    edge(root,branch,'子赛道','上级赛道')
                    count(branch,company,deal)
                    parent_nodes.append(branch)
                parent_nodes = parent_nodes or [root]
                business = r.get('sub')
                if business in [BRANCHES[branch] for branch in r['sectorBranches']]:
                    business = ''
                if business:
                    url = 'search.html?'+urlencode({'sector': sector, 'sub': business})
                    direction = node('业务方向',business,url,r.get('subId'))
                    for parent in parent_nodes:
                        edge(parent,direction,'业务方向','所属赛道')
                    count(direction,company,deal)
                    parent_nodes = [direction]
                for parent in parent_nodes:
                    edge(parent,company,'公司','所属方向')
                edge(company,deal,'融资记录','融资公司')
                for inv in r['investors']:
                    investor=node('机构',inv,dict(r.get('parties',[])).get(inv) or (filename('institution',inv) if inv in live_by_investor else ''))
                    edge(deal,investor,'参与投资','参与融资')
                for rid in r.get('reports',[]):
                    edge(deal,node('周报',reports[rid]['title'],'report-'+rid+'.html',rid),'关联研究','相关融资')
        write_group(sector,'融资赛道','sector-'+sector,financing)
    for topic,title in topics.items():
        def research(root,node,edge,count):
            for rid,r in reports.items():
                if r['topic']!=topic: continue
                for item in r['events']:
                    branch=node('细分方向',subject(topic,item))
                    evidence=node('研究事件',item['title'])
                    edge(root,branch,'细分方向','研究方向')
                    edge(branch,evidence,'研究事件','归属方向')
                    edge(evidence,node('周报',r['title'],'report-'+rid+'.html',rid),'收录周报','研究事件')
                    if item['company']:
                        edge(evidence,node('研究主体',item['company']),'涉及主体','相关事件')
        write_group(title,'研究方向','topic-'+topic,research)
    chunks=defaultdict(dict)
    for name,hits in lookup.items():
        if name:chunks[ord(name.lower()[0])%128][name]=hits
    for bucket,items in chunks.items():
        (directory/f'search-{bucket}.json').write_text(json.dumps(items,ensure_ascii=False,separators=(',',':')))
    (directory/'search.json').write_text(json.dumps(list(chunks)))
    options=''.join(f'<option value="{f}" data-root="{escape(root,quote=True)}">{escape(title)}</option>' for title,f,root in catalog)
    return ('<link rel="stylesheet" href="atlas.css"><section id="atlas"><div class="atlas-tools">'
            '<select aria-label="选择赛道或研究方向">'+options+'</select><input type="search" placeholder="搜索画布" aria-label="搜索画布"></div>'
            '<div id="atlas-results"></div><div id="atlas-view" aria-label="关系画布"><div id="atlas-world"></div></div>'
            '<div class="atlas-controls"><button id="atlas-back">返回上层</button><button id="atlas-minus" aria-label="缩小">−</button>'
            '<button id="atlas-plus" aria-label="放大">＋</button><button id="atlas-center">居中</button><a id="atlas-open" hidden>打开档案 ↗</a></div>'
            '<output id="atlas-status" aria-live="polite"></output></section><script defer src="atlas.js"></script>')
