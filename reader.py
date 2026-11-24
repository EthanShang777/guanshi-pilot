"""Static public reading views for the archived research library."""
from collections import defaultdict
from html import escape as esc
import json
from pathlib import Path
from urllib.parse import urlencode

TOPICS = {'ai4s':'科学智能','rsi':'递归自我改进','ai-applications':'AI 应用',
          'ai-infra':'AI 基础设施','embodied-intelligence':'具身智能','world-model':'世界模型'}

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
        body='<p class="intro">'+esc(r['summary'])+'</p>'+subsection('关联融资公司',directory(related) if related else '')
        events=''.join(card(esc(e['title']),'<p>'+esc(e['summary'])+'</p>'+sources(e['sources'])) for e in r['events'])
        body+=subsection('当周事件与证据',events)+subsection('本期来源',sources(r['sources']))
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
                nodes[e['sub'] or '研究事件'].setdefault(e['title'],(e,rid))
        sections=''
        for sub,items in nodes.items():
            details=''
            for e,rid in items.values():
                company=e['company']
                label=link(filename('research-profile',company),company) if company in by_name else esc(company)
                details+=card(esc(e['title']),'<p>'+label+'</p>'+reportlink(rid))
            sections+=f'<details class="research-node"><summary>{esc(sub)} · {len(items)} 项</summary>{details}</details>'
        page('landscape-'+topic+'.html',TOPICS[topic],'赛道画布',subsection('历期研究',directory([reportlink(rid) for rid in ids]))+subsection('细分方向与证据',sections))
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
        fields=''.join('<dt>'+label+'</dt><dd>'+esc(r[k])+'</dd>' for k,label in [('question','跟踪问题'),('original','此前判断'),('reason','复核结论'),('next','下次验证')] if r[k])
        changes+=card(esc(r['title']),'<small>'+esc(r['day'])+'</small><dl>'+fields+'</dl>'+sources(r['sources']))
    page('changes.html','变化追踪','变化追踪',changes,meta='有复核记录的历史判断')
