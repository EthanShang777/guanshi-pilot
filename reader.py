"""Static public reading views for the archived research library."""
from collections import defaultdict
from hashlib import sha256
from html import escape as esc
import json
import re
import shutil
from pathlib import Path
from unicodedata import normalize
from urllib.parse import urlencode

TOPICS = {'ai4s':'科学智能','rsi':'递归自我改进','ai-applications':'AI 应用',
          'ai-infra':'AI 基础设施','embodied-intelligence':'具身智能','world-model':'世界模型'}

SUBJECTS = {
    'ai-infra': [('芯片与计算架构','GPU|芯片|机架|硅片|存算|光互连'),('推理与部署','推理|部署|计算服务|迁移'),('评测与运维','评测|运维|工具|故障')],
    'world-model': [('动作与规划','动作|规划|控制'),('仿真与验证','仿真|测试|评测|验证'),('交互与生成','交互|生成|视频')],
    'ai-applications': [('办公与企业交付','办公|工作|企业|采购'),('付费与分发','付费|支付|收费|留存|分发')],
    'embodied-intelligence': [('部署与交付','客户|部署|试运行|量产'),('感知与控制','触觉|控制|关节|动作'),('机器人本体','本体|整机|人形')],
    'ai4s': [('实验与数据','实验|数据|评测'),('临床与监管','临床|监管|药物')],
    'rsi': [('评估与泛化','评估|验证|基准|泛化'),('学习与迭代','学习|更新|改进|迭代')],
}
LABELS = {'brain':'具身决策','body':'机器人本体','cerebellum':'运动控制','control':'运动控制','dexterous-hand':'灵巧手',
          'strategic_cooperation':'产业合作','engineering_disclosure':'工程进展','benchmark_milestone':'评测进展',
          'research_infrastructure':'研究设施','commercial_case_study':'商业案例','clinical_financial_update':'临床与融资',
          'financing_and_product_announcement':'融资与产品','institutional_resource_commitment':'机构资源投入',
          'pipeline_regulatory_submission':'管线与监管申报','government_research_award':'科研资助','registry_disclosure':'登记披露'}

def subject(topic,event):
    raw=event['sub']
    if raw in LABELS: return LABELS[raw]
    if raw and not raw.isascii(): return raw
    title=event['title']
    if re.search('融资|认购|配售|种子轮|A轮|B轮|并购',title) or raw=='financing_announcement':return '融资与交易'
    for name,pattern in SUBJECTS[topic]:
        if re.search(pattern,title):return name
    return '产品与研究进展'

def event_url(rid, event):
    key = sha256(event['title'].encode()).hexdigest()[:14]
    return f'report-{rid}.html#evidence-{key}'


def judgment_link(link, archive='', source=''):
    params = {}
    match = re.fullmatch(r'(company|institution)\.html\?id=([a-f0-9]{24})', archive)
    if match:
        params.update(type=match[1], id=match[2])
    if source:
        params['source'] = source
    return link('judgments.html?'+urlencode(params), '保存到我的判断') if params else ''


def archive_lookup(index_rows, live, profiles, filename, fund_ids):
    routes = defaultdict(set)
    profile_routes = defaultdict(set)

    def key(name):
        return normalize('NFKC', name).strip().casefold()

    for row in index_rows:
        if href := row.get('companyHref'):
            for name in (row['company'], *row.get('aliases', ())):
                routes[key(name)].add(('公司', href))
        for name, href in row.get('parties', ()):
            role = '基金' if href.removeprefix('institution.html?id=') in fund_ids else '机构'
            routes[key(name)].add((role, href))
    for row in live:
        company = row['company']
        routes[key(company)].add(('公司', filename('company',company)))
        for name in row['investors']:
            routes[key(name)].add(('机构', filename('institution',name)))
    for name in profiles:
        profile_routes[key(name)].add(('公司', filename('research-profile',name)))

    def resolve(names):
        if not names:
            return []
        if key(names) in routes or key(names) in profile_routes:
            entries = [names]
        else:
            entries = re.split(r'\s*[/、；;]\s*', names)
        matches = []
        for name in dict.fromkeys(filter(None, entries)):
            choices = routes.get(key(name)) or profile_routes.get(key(name)) or ()
            matches.append((name, next(iter(choices)) if len(choices) == 1 else None))
        return matches

    return resolve


def build_library(page,link,filename,reports,companies,index_rows,live):
    library = json.loads(Path('research-library.json').read_text())
    profiles = {p['name']: p for p in library['profiles']}
    fund_ids = {f['fundId'] for f in json.loads(Path('institution-fund-lps.json').read_text())}
    archives = archive_lookup(index_rows, live, profiles, filename, fund_ids)
    sheet = '<link rel="stylesheet" href="report-reader.css?v=workbench1">'

    def sources(refs):
        return '<ul class="source-list">'+''.join('<li>'+link(s['url'],s['title'])+'</li>' for s in refs)+'</ul>' if refs else ''

    def card(title, body, ident=''):
        anchor = f' id="{esc(ident, quote=True)}"' if ident else ''
        return f'<article class="report-card"{anchor}><h3>{title}</h3>{body}</article>'

    def directory(entries):
        return '<ul class="report-links">'+''.join('<li>'+a+'</li>' for a in entries)+'</ul>' if entries else ''

    def reportlink(rid):
        return link('report-'+rid+'.html',reports[rid]['title'])

    def subsection(title, content, style='report-section'):
        return f'<section class="{style}"><h2>{title}</h2>{content}</section>' if content else ''

    def reading(content):
        return sheet + '<div class="report-reader">' + content + '</div>'

    def named_links(event):
        return [link(spec[1], name) if spec else esc(name) for name,spec in archives(event['company'])]

    def evidence_card(rid, evidence):
        matches = archives(evidence['company'])
        named = named_links(evidence)
        linked = [spec[1] for _,spec in matches if spec and re.fullmatch(r'(company|institution)\.html\?id=[a-f0-9]{24}', spec[1])]
        route = linked[0] if len(linked) == 1 else ''
        record = event_url(rid, evidence)
        content = '<p>'+esc(evidence['summary'])+'</p>'
        if named:
            content += '<p class="report-objects">'+'、'.join(named)+'</p>'
        content += sources(evidence['sources']) + '<div class="report-actions">'+judgment_link(link, route, record)+'</div>'
        return card(esc(evidence['title']), content, record.split('#', 1)[1])

    by_topic = defaultdict(list)
    by_week = defaultdict(list)
    linked_deals = defaultdict(dict)
    for row in index_rows:
        for rid in row.get('reports', ()):
            if row.get('companyHref'):
                linked_deals[rid].setdefault(row['companyHref'], row['company'])
    for rid,r in sorted(reports.items(), reverse=True):
        by_topic[r['topic']].append(rid)
        by_week[r['week']].append(rid)
        related = linked_deals[rid].copy()
        for name, items in companies.items():
            if any(rid in item.get('reports', ()) for item in items):
                for _, spec in archives(name):
                    if spec and spec[0] == '公司':
                        related.setdefault(spec[1], name)
                        break
                else:
                    related.setdefault(filename('research-company',name),name)
        lead = next((e for e in r['events'] if e['title'] == r.get('lead_evidence')),None)
        timing = [('覆盖区间', r['start']+' 至 '+r['end']), ('期次', r['week']),
                  ('发布时间', r.get('published') or '档案未单列'),
                  ('后续更新', r.get('updated') or '未登记本期更新')]
        timing = '<dl class="report-timing">'+''.join('<div><dt>'+label+'</dt><dd>'+esc(value)+'</dd></div>' for label,value in timing)+'</dl>'
        topic_path = 'landscape-'+r['topic']+'.html'
        body = timing+'<div class="report-actions">'+link('reports.html','全部周报')+link(topic_path,TOPICS[r['topic']])+'</div>'
        body += '<p class="reading-lead">'+esc(r.get('reading_lead') or r['summary'])+'</p>'
        if lead:
            anchor = '#'+event_url(rid, lead).split('#', 1)[1]
            body += '<p class="report-lead-evidence">'+link(anchor,'本期主要证据 · '+lead['title'])+'</p>'
        body += subsection('关联融资公司', directory([link(url,name) for url,name in related.items()]))
        grouped = defaultdict(list)
        for e in r['events']:
            grouped[subject(r['topic'],e)].append(e)
        for label, events in grouped.items():
            body += subsection(esc(label), ''.join(evidence_card(rid,e) for e in events))
        body += '<details class="research-node"><summary>完整摘要与本期来源</summary><p>'+esc(r['summary'])+'</p>'+sources(r['sources'])+'</details>'
        page('report-'+rid+'.html', r['title'], '研究周报', reading(body))

    topic_links = '<nav class="report-actions" aria-label="研究路径">'+''.join(
        [link('compare.html','公司比较'),link('landscape.html','赛道探索'),link('changes.html','历史复核')])+'</nav>'
    topics = '<nav class="report-actions" aria-label="研究方向">'+''.join(
        link('landscape-'+k+'.html',v) for k,v in TOPICS.items())+'</nav>'
    weeks = ''.join(subsection(esc(w), directory([reportlink(rid) for rid in ids]), 'report-week') for w,ids in by_week.items())
    page('reports.html', '研究周报', '研究周报', reading(topic_links+topics+weeks))

    from atlas import build_atlas
    page('landscape.html','赛道画布','赛道画布',build_atlas(index_rows,reports,live,filename,TOPICS,subject,archives,event_url,fund_ids))
    for topic, ids in by_topic.items():
        nodes = defaultdict(dict)
        for rid in ids:
            for e in reports[rid]['events']:
                nodes[subject(topic,e)].setdefault(e['title'],(e,rid))
        sections = ''
        for sub, items in nodes.items():
            details = ''
            for e,rid in items.values():
                named = '、'.join(named_links(e))
                details += card(esc(e['title']), ('<p class="report-objects">'+named+'</p>' if named else '')+
                                link(event_url(rid,e),'查看报告证据'))
            sections += f'<details class="research-node"><summary>{esc(sub)} · {len(items)} 项</summary>{details}</details>'
        opens = ('<div class="report-actions">'+link('landscape.html?'+urlencode({'scope':topic}),'查看关系图')+
                 link('landscape.html?'+urlencode({'scope':topic,'view':'list'}),'查看关系列表')+'</div>')
        page('landscape-'+topic+'.html',TOPICS[topic],'赛道画布',reading(opens+subsection('细分方向与证据',sections)+
             subsection('历期研究',directory([reportlink(rid) for rid in ids]))))

    for name, profile in profiles.items():
        facts = ''.join(card('档案判断','<p>'+esc(c['text'])+'</p>'+
                        ''.join('<p class="hint">'+esc(v)+'</p>' for v in c['limits'])+sources(c['sources'])) for c in profile['claims'])
        archive = next((spec[1] for _,spec in archives(name) if spec and spec[0] == '公司'), '')
        actions = '<div class="report-actions">'+link('research-companies.html','公司研究库')
        if archive and archive != filename('research-profile',name):
            actions += link(archive,'融资档案')+judgment_link(link, archive)
        actions += '</div>'
        body = actions+subsection('研究问题','<p>'+esc(profile['question'])+'</p>' if profile['question'] else '')+facts
        page(filename('research-profile',name),name,'公司档案',reading(body),meta='研究档案　'+profile['asof'])
    entries = sorted(profiles)
    page('research-companies.html','公司研究库','公司档案',reading('<div class="report-actions">'+link('compare.html','公司比较')+'</div>'+
         directory([link(filename('research-profile',n),n) for n in entries])))

    reviews = sorted(library['reviews'], key=lambda r:r['day'], reverse=True)
    changes = ''
    month = None
    for r in reviews:
        if month != r['day'][:7]:
            month = r['day'][:7]
            changes += f'<h2 id="review-{month}" class="report-month">{month}</h2>'
        fields = ''.join('<dt>'+label+'</dt><dd>'+esc(r[k])+'</dd>' for k,label in [
            ('question','跟踪问题'),('original','复核前的判断'),('reason','完整复核说明'),('next','下次验证')]
            if r[k] and (k!='question' or r[k]!=r['title']))
        ref = r['sources'][0]
        changes += card(esc(r['title']),'<p class="report-objects">'+esc(r['day'])+' 复核</p><p>'+esc(r.get('reading_result') or r['reason'])+'</p>'+
                        link(ref['url'],ref['title']+' ↗')+'<details class="research-node"><summary>原问题与验证条件</summary><dl>'+fields+'</dl>'+sources(r['sources'])+'</details>')
    page('changes.html','变化追踪','变化追踪',reading(changes))


def refresh_library(out, page, link, filename, deals):
    """Regenerate discovery assets from public deals already present in the Pages snapshot."""
    import atlas
    atlas.OUTPUT = out/'atlas'
    for name in ('atlas.js', 'atlas.css', 'report-reader.css'):
        shutil.copyfile(name, out/name)
    reports = json.loads(Path('research-index.json').read_text())
    build_library(page, link, filename, reports, {}, list(deals), [])
