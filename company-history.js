const companyHistory=(()=>{
  function el(tag,text){const n=document.createElement(tag);if(text)n.textContent=text;return n;}
  function link(url,title){const a=el('a',title);a.href=url;return a;}
  function timeline(row){
    const list=el('ol');list.className='company-history';
    for(const [url,day,stage,amount,parties,sources] of row.events){
      const item=el('li');item.append(el('time',day||'日期未记录'),link(url,[stage||'融资',amount].filter(Boolean).join(' · ')));
      if(parties.length){
        const p=el('p','投资方　');parties.forEach(([n,u],i)=>{if(i)p.append('、');p.append(link(u,n));});item.append(p);
      }
      if(sources.length)item.append(link(sources[0],'查看来源 ↗'));
      list.append(item);
    }
    return list;
  }
  return {el,link,timeline};
})();
