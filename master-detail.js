(async()=>{
  const root=document.querySelector('#record'), kind=root.dataset.kind;
  const id=new URLSearchParams(location.search).get('id');
  const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const link=(url,text)=>{const a=el('a',text);a.href=url;return a;};
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
      for(const [n,url] of row.parties)parties.append(link(url,n+' →'));
      if(!row.parties.length)parties.append(el('p','未列明'));root.append(parties);
      for(const rid of row.reports)root.append(link('report-'+rid+'.html','相关研究 →'));
      for(const url of row.sources){const p=el('p','');p.append(link(url,'来源 · '+new URL(url).hostname));root.append(p);}
    }else{
      root.append(el('h2',(kind==='company'?'融资历程':'投资记录')+' · '+row.events.length+' 笔'));
      for(const [url,company,day,stage,amount] of row.events){
        const a=link(url,[day||'日期未列明',company,stage,amount].filter(Boolean).join(' · '));a.className='directory-row';root.append(a);
      }
    }
  }catch{root.append(el('p','档案加载失败，请刷新重试。'),link('search.html','返回融资检索'));}
})();
