(async()=>{
  const root=document.querySelector('#record'), kind=root.dataset.kind;
  const id=new URLSearchParams(location.search).get('id');
  const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const link=(url,text)=>{const a=el('a',text);a.href=url;return a;};
  function context(url,sector,sub){
    const target=new URL(url,location.href);
    if(sector)target.searchParams.set('sector',sector);
    if(sub)target.searchParams.set('sub',sub);
    return target.href;
  }
  if(!id && root.dataset.default){location.replace(root.dataset.default);return;}
  try{
    if(!/^[a-f0-9]{24}$/.test(id||''))throw Error();
    const res=await fetch('records/'+kind+'-'+id.slice(0,2)+'.json');
    if(!res.ok)throw Error();
    const row=(await res.json())[id];if(!row)throw Error();
    const name=row.company||row.name;
    document.querySelector('h1').textContent=name;document.title=name+' · 观势';
    if(kind==='deal'){
      const summary=el('section','');summary.className='deal-summary';
      for(const [label,value] of [['披露金额',row.amount],['融资轮次',row.stage],['估值',row.valuation]]){
        if(!value && label==='估值')continue;
        const cell=el('div','');cell.append(el('small',label),el('strong',value||'未列明'));summary.append(cell);
      }
      root.append(summary,el('p',[row.dateKind,row.day||'日期未列明',row.location,row.sector,row.sub].filter(Boolean).join(' · ')),link(row.companyHref,'公司档案 →'));
      const parties=el('section','');parties.className='counterparties';parties.append(el('h2','参与机构'));
      for(const [n,url] of row.parties)parties.append(link(context(url,row.sector,row.sub),n+' →'));
      if(!row.parties.length)parties.append(el('p','未列明'));root.append(parties);
      for(const rid of row.reports)root.append(link('report-'+rid+'.html','相关研究 →'));
      for(const url of row.sources){const p=el('p','');p.append(link(url,'来源 · '+new URL(url).hostname));root.append(p);}
    }else if(kind==='company'){
      if(row.primary){
        const adjacent=new URLSearchParams({view:'institutions',sector:row.primary,client:id});
        if(row.sub)adjacent.set('adjacent',row.sub);
        root.append(link('workspace.html?'+adjacent,'找相邻方向投资方 →'),el('span','　'));
      }
      if(row.sub){
        root.append(link(context('workspace.html?view=companies',row.primary,row.sub),'对照同行 · '+row.sub+' →'));
      }
      if(row.profile){
        const claim=row.profile.claims.find(c=>c.sources.length);
        if(claim){
          root.append(el('h2','公司研究 · '+row.profile.asof),el('p',claim.text));
          for(const source of claim.sources)root.append(link(source.url,source.title+' ↗ '));
          if(row.profile.question)root.append(el('p',row.profile.question));
        }
      }
      root.append(el('p',[row.location,row.sector].filter(Boolean).join(' · ')),el('h2','融资历程 · '+row.events.length+' 笔'),companyHistory.timeline(row,context));
    }else{
      const params=new URLSearchParams(location.search),sub=params.get('sub'),sector=params.get('sector');
      const related=row.events.filter(r=>sub?r[6]===sub && (!sector||r[5]===sector):sector && r[5]===sector);
      if(sub||sector){
        const companies=new Map();
        for(const r of related){
          if(!companies.has(r[7]))companies.set(r[7],[]);
          companies.get(r[7]).push(r);
        }
        root.append(el('h2',(sub||sector)+' · '+companies.size+' 家公司 · '+related.length+' 笔'));
        for(const events of companies.values()){
          const section=el('section','');section.append(link(events[0][7],events[0][1]));
          for(const [url,,day,stage,amount] of events){
            const p=el('p','');p.append(link(url,[day,stage,amount].filter(Boolean).join(' · ')));section.append(p);
          }
          root.append(section);
        }
      }
      root.append(el('h2','全部投资记录 · '+row.events.length+' 笔'));
      for(const [url,company,day,stage,amount] of row.events){
        const a=link(url,[day||'日期未列明',company,stage,amount].filter(Boolean).join(' · '));a.className='directory-row';root.append(a);
      }
    }
  }catch{root.append(el('p','档案加载失败，请刷新重试。'),link('search.html','返回融资检索'));}
})();
