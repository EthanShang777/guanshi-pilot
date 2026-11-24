"""Static public reading views for the archived research library."""
from collections import defaultdict
from html import escape as esc
import json
import re
from pathlib import Path
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

def build_library(page,link,filename,reports,companies,index_rows):
    library=json.loads(Path('research-library.json').read_text())
    def sources(refs):
        return '<ul class="source-list">'+''.join('<li>'+link(s['url'],s['title'])+'</li>' for s in refs)+'</ul>' if refs else ''
    def card(title,body):
        return '<article class="deal"><h3>'+title+'</h3>'+body+'</article>'
    def directory(entries):
        return '<div class="profile-directory">'+''.join('<div class="directory-row">'+a+'</div>' for a in entries)+'</div>'
    def reportlink(rid):
        return link('report-'+rid+'.html',reports[rid]['title'])
    def subsection(title,content):
        return '<section class="profile-records"><h2>'+title+'</h2>'+content+'</section>' if content else ''
    by_topic=defaultdict(list)
    by_week=defaultdict(list)
    for rid,r in sorted(reports.items(),reverse=True):
        by_topic[r['topic']].append(rid)
        by_week[r['week']].append(rid)
        related=[link(filename('research-company',n),n) for n,items in companies.items() if any(rid in item['reports'] for item in items)]
        lead=next((e for e in r['events'] if e['title']==r.get('lead_evidence')),None)
        body='<p class="reading-lead">'+esc(r.get('reading_lead') or r['summary'])+'</p>'
        if lead:
            body+=card(esc(lead['title']),'<p>'+esc(lead['summary'])+'</p>'+link(lead['sources'][0]['url'],'查看这条证据 ↗'))
        body+=subsection('关联融资公司',directory(related) if related else '')
        grouped=defaultdict(list)
        for e in r['events']:grouped[subject(r['topic'],e)].append(e)
        for label,events in grouped.items():
            body+=f'<details class="research-node"><summary>{esc(label)} · {len(events)} 项</summary>'+''.join(card(esc(e['title']),'<p>'+esc(e['summary'])+'</p>'+sources(e['sources'])) for e in events)+'</details>'
        body+='<details class="research-node"><summary>完整摘要与本期来源</summary><p>'+esc(r['summary'])+'</p>'+sources(r['sources'])+'</details>'
        page('report-'+rid+'.html',r['title'],'研究周报',body,meta=TOPICS[r['topic']]+'　'+r['start']+' — '+r['end'])
    topic_links=directory([link('landscape-'+k+'.html',v) for k,v in TOPICS.items()])
    weeks=''.join(subsection(esc(w),directory([reportlink(rid) for rid in ids])) for w,ids in by_week.items())
    page('reports.html','研究周报','研究周报',topic_links+weeks,meta='按方向或归档周阅读')
    page('landscape.html','赛道画布','赛道画布',topic_links+subsection('融资行业',directory([
        link('search.html?'+urlencode({'sector':s}),s) for s in sorted({r['sector'] for r in index_rows})])),meta='研究方向与融资行业')
    profiles=library['profiles']
    by_name={p['name']:p for p in profiles}
    for topic,ids in by_topic.items():
        nodes=defaultdict(dict)
        for rid in ids:
            for e in reports[rid]['events']:
                nodes[subject(topic,e)].setdefault(e['title'],(e,rid))
        sections=''
        for sub,items in nodes.items():
            details=''
            for e,rid in items.values():
                company=e['company']
                label=link(filename('research-profile',company),company) if company in by_name else esc(company)
                details+=card(esc(e['title']),'<p>'+label+'</p>'+reportlink(rid))
            sections+=f'<details class="research-node"><summary>{esc(sub)} · {len(items)} 项<small>{esc(next(iter(items)))}</small></summary>{details}</details>'
        page('landscape-'+topic+'.html',TOPICS[topic],'赛道画布',subsection('细分方向与证据',sections)+subsection('历期研究',directory([reportlink(rid) for rid in ids])))
    for profile in profiles:
        n=profile['name']
        facts=''.join(card('档案判断','<p>'+esc(c['text'])+'</p>'+
                      ''.join('<p class="hint">'+esc(v)+'</p>' for v in c['limits'])+sources(c['sources'])) for c in profile['claims'])
        body=subsection('研究问题','<p>'+esc(profile['question'])+'</p>' if profile['question'] else '')+facts
        page(filename('research-profile',n),n,'公司档案',body,meta='研究档案　'+profile['asof'])
    entries=sorted(by_name)
    page('research-companies.html','公司研究库','公司档案',link('compare.html','对照两家公司 →')+directory([link(filename('research-profile',n),n) for n in entries]))
    options=''.join(f'<option value="{i}">{esc(n)}</option>' for i,n in enumerate(entries))
    sample=[{'name':n,'href':filename('research-profile',n),'claim':by_name[n]['claims'][0]['text'],
             'question':by_name[n]['question'],'source':by_name[n]['claims'][0]['sources'][0]} for n in entries]
    compare='<div class="comparison">'+''.join('<section><label>'+label+'<select>'+options+'</select></label><h2></h2><p></p><p></p><a></a> · <a>完整档案</a></section>' for label in ['公司一','公司二'])+'</div>'
    compare+='<script type="application/json" id="profiles">'+json.dumps(sample,ensure_ascii=False).replace('<',r'\u003c')+'</script><script>'+Path('compare.js').read_text()+'</script>'
    page('compare.html','公司对照','公司档案',compare,meta='档案判断、待验证问题与依据')
    changes=''
    for r in sorted(library['reviews'],key=lambda r:r['day'],reverse=True):
        fields=''.join('<dt>'+label+'</dt><dd>'+esc(r[k])+'</dd>' for k,label in [('question','跟踪问题'),('original','此前判断'),('reason','完整复核说明'),('next','下次验证')] if r[k] and (k!='question' or r[k]!=r['title']))
        ref=r['sources'][0]
        changes+=card(esc(r['title']),'<small>'+esc(r['day'])+' 复核</small><p class="review-result">'+esc(r.get('reading_result') or r['reason'])+'</p>'+
                      link(ref['url'],ref['title']+' ↗')+'<details class="research-node"><summary>此前判断与验证条件</summary><dl>'+fields+'</dl>'+sources(r['sources'])+'</details>')
    page('changes.html','变化追踪','变化追踪',changes,meta='有复核记录的历史判断')
