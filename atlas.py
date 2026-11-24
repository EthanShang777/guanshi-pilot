"""Build small, independently loadable public graph slices."""
import json
from collections import defaultdict
from pathlib import Path
from html import escape


def build_atlas(rows, reports, live, filename, topics, subject):
    directory = Path('atlas')
    directory.mkdir(exist_ok=True)
    catalog = []
    lookup = defaultdict(list)
    live_by_company = {e['company'] for e in live}
    live_by_investor = {name for e in live for name in e['investors']}

    def write_group(title, kind, key, populate):
        nodes = {}
        def node(role, name, url='', identity=None):
            ident = role+'|'+(identity or name)
            nodes.setdefault(ident, dict(name=name, role=role, url=url, edges=[]))
            return ident
        def edge(a, b, verb, reverse):
            for src, dst, label in [(a,b,verb),(b,a,reverse)]:
                entry = [dst,label]
                if entry not in nodes[src]['edges']:
                    nodes[src]['edges'].append(entry)
        root = node(kind,title)
        populate(root,node,edge)
        if kind == '融资赛道':
            for ident, n in nodes.items():
                if ident == root:
                    members = {i for i,item in nodes.items() if item['role']=='公司'}
                elif n['role']=='业务方向':
                    members = {i for i,_ in n['edges'] if nodes[i]['role']=='公司'}
                else:
                    continue
                deals = {i for company in members for i,_ in nodes[company]['edges'] if nodes[i]['role']=='融资'}
                n['summary']=f'{len(members)} 家公司 · {len(deals)} 笔融资'
        file = filename('graph',key).replace('.html','.json')
        (directory/file).write_text(json.dumps(nodes,ensure_ascii=False,separators=(',',':')))
        catalog.append([title,file,root])
        for ident,n in nodes.items():
            lookup[n['name']].append([file,ident])
    groups = defaultdict(list)
    for row in rows:
        groups[row['sector']].append(row)
    by_href = {('event.html' if e['id']=='seed' else 'event-'+e['id']+'.html'):e for e in live}
    for sector,items in sorted(groups.items(),key=lambda pair:pair[0]!='芯片与算力'):
        def financing(root,node,edge):
            for r in items:
                name=r['company']
                company=node('公司',name,filename('company',name) if name in live_by_company else '')
                business=by_href.get(r['href'],{}).get('business')
                parent=root
                if business:
                    parent=node('业务方向',business)
                    edge(root,parent,'业务方向','所属赛道')
                edge(parent,company,'公司','所属方向')
                deal=node('融资',name+' · '+r['day']+' · '+(r['stage'] or '轮次未列明'),r['href'],r['href'])
                edge(company,deal,'融资记录','融资公司')
                for inv in r['investors']:
                    investor=node('机构',inv,filename('institution',inv) if inv in live_by_investor else '')
                    edge(deal,investor,'参与投资','参与融资')
                for rid in r.get('reports',[]):
                    edge(deal,node('周报',reports[rid]['title'],'report-'+rid+'.html',rid),'关联研究','相关融资')
        write_group(sector,'融资赛道','sector-'+sector,financing)
    for topic,title in topics.items():
        def research(root,node,edge):
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
    (directory/'search.json').write_text(json.dumps(lookup,ensure_ascii=False,separators=(',',':')))
    options=''.join(f'<option value="{f}" data-root="{escape(root,quote=True)}">{escape(title)}</option>' for title,f,root in catalog)
    return ('<link rel="stylesheet" href="atlas.css"><section id="atlas"><div class="atlas-tools">'
            '<select aria-label="选择赛道或研究方向">'+options+'</select><input type="search" placeholder="搜索画布" aria-label="搜索画布"></div>'
            '<div id="atlas-results"></div><div id="atlas-view" aria-label="关系画布"><div id="atlas-world"></div></div>'
            '<div class="atlas-controls"><button id="atlas-back">返回上层</button><button id="atlas-minus" aria-label="缩小">−</button>'
            '<button id="atlas-plus" aria-label="放大">＋</button><button id="atlas-center">居中</button><a id="atlas-open" hidden>打开档案 ↗</a></div>'
            '<output id="atlas-status" aria-live="polite"></output></section><script defer src="atlas.js"></script>')
