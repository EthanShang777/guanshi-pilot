const companyHistory=(()=>{
  function el(tag,text){const n=document.createElement(tag);if(text)n.textContent=text;return n;}
  function link(url,title){const a=el('a',title);a.href=url;return a;}
  function timeline(row,context){
    const list=el('ol');list.className='company-history';
    for(const [url,day,stage,amount,parties,sources,sector,sub] of row.events){
      const item=el('li');item.append(el('time',day||'日期未记录'),link(url,stage||'轮次未记录'),el('span','披露金额　'+(amount||'未记录')));
      if(parties.length){
        const p=el('p','投资方　');parties.forEach(([n,u],i)=>{if(i)p.append('、');p.append(link(context?context(u,sector,sub):u,n));});item.append(p);
      }
      if(sources.length)item.append(link(sources[0],'查看来源 ↗'));
      list.append(item);
    }
    return list;
  }
  return {el,link,timeline};
})();
