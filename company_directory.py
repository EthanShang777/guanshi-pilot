from html import escape
from collections import defaultdict

from sector_taxonomy import BRANCHES
from urllib.parse import urlencode


def directory_url(**filters):
    return 'companies.html?'+urlencode(filters)


def build_directory(entities, by_sector, data, out, page, dump, link, redirect, sector_url, excluded_stages):
    ordered=sorted(entities.values(),key=lambda e:e['events'][0]['day'],reverse=True)
    index=[]
    summaries=[]
    directions=defaultdict(set)
    for company in ordered:
        events=company['events']
        latest=events[0]
        aliases=sorted({n for event in events for n in event['aliases']})
        eligible = [event for event in events if event['stage'] not in excluded_stages]
        sectors = list(dict.fromkeys(event['sector'] for event in eligible))
        filters = sorted({(event['sector'], event['sub'], tuple(event['sectorBranches'])) for event in eligible})
        for sector, sub, branches in filters:
            if sub:
                directions[sector].add(sub)
            directions[sector].update(BRANCHES[branch] for branch in branches)
        index.append([company['name'], aliases, sectors, filters])
        summaries.append([company['key'],company['name'],latest['location'],latest['sub'] or latest['sector'],
                          latest['day'],latest['stage'],latest['amount'],latest['parties'],len(events),latest['href']])
    dump(data/'company-lookup.json',index)
    dump(data/'company-directions.json',{sector: sorted(names) for sector, names in directions.items()})
    size=30
    for i in range(0,len(summaries),size):
        dump(data/f'company-summary-{i//size}.json',summaries[i:i+size])
    def card(r):
        key,name,location,sector,day,stage,amount,parties,count,url=r
        info=' · '.join(filter(None,[location,sector]))
        facts=' · '.join(filter(None,[day,stage,amount])) or '交易信息未列明'
        investors='、'.join(link(u,n) for n,u in parties)
        return ('<article class="company-entry"><header><h2>'+link('company.html?id='+key,name)+'</h2><small>'+escape(info)+'</small></header>'
                '<div><a class="company-deal" href="'+url+'">'+escape(facts)+'</a>'+
                ('<p>投资方　'+investors+'</p>' if investors else '')+'</div>'+
                '<details data-company="'+key+'"><summary>交易记录 · '+str(count)+' 笔</summary></details></article>')
    options=''.join('<option>'+escape(s)+'</option>' for s in sorted(by_sector))
    controls=('<section class="company-catalog" data-total="'+str(len(index))+'"><div class="company-tools">'
              '<input type="search" aria-label="搜索全部公司" placeholder="搜索公司全称或简称"><select aria-label="行业赛道">'
              '<option value="">全部赛道</option>'+options+'</select><select aria-label="细分方向">'
              '<option value="">全部方向</option></select></div><p role="status" class="company-count">'+
              f'{len(index):,} 份档案 · 最近交易优先</p><div id="company-results">'+''.join(map(card,summaries[:size]))+
              '</div><nav class="company-pager"><button disabled>上一页</button><button>下一页</button></nav></section>'+
              link('research-companies.html','公司研究与同行对照 →')+'<script src="sector-filter.js?v=1"></script><script defer src="company-browser.js?v=foundation1"></script>')
    page('companies.html','公司档案','公司档案',controls)
    for i in range(1,(len(index)+59)//60):
        redirect(f'companies-{i+1}.html',directory_url(page=i*2+1))
    for s,items in by_sector.items():
        base=sector_url('公司档案',s)
        for i in range((len(items)+59)//60):
            redirect(base if i==0 else base[:-5]+f'-{i+1}.html',directory_url(sector=s,page=i*2+1))
