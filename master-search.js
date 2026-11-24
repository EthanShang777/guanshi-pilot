(async()=>{
  const form=document.querySelector('#archive-form'), count=document.querySelector('#match-count'),list=document.querySelector('#matches');
  const keys=['company','investor','sector','year','stage'];
  const load=async name=>{const res=await fetch('records/'+name+'.json');if(!res.ok)throw Error();return res.json();};
  try{
    const meta=await load('manifest'), args=new URLSearchParams(location.search),cache=new Map();
    for(const [key,items] of [['year',meta.years],['sector',meta.sectors]])for(const s of items)form.elements[key].add(new Option(s,s));
    keys.forEach(k=>form.elements[k].value=args.get(k)||'');
    let page=Math.max(1,parseInt(args.get('page'))||1),version=0,timer;
    async function show(){
      const seq=++version, values=keys.map(k=>form.elements[k].value.trim().toLowerCase());
      const [company,investor,sector,year,stage]=values;
      const filtering=values.some(Boolean), found=[];
      count.textContent='正在检索…';
      try{
        for(const y of year?[form.elements.year.value]:meta.years){
          if(!cache.has(y))cache.set(y,load('search-'+y).catch(e=>{cache.delete(y);throw e;}));
          const rows=await cache.get(y);if(seq!==version)return;
          for(const r of rows){
            if(![r[1],...r[2]].some(n=>n.toLowerCase().includes(company)) || investor && !r[7].some(n=>n.toLowerCase().includes(investor)) ||
               sector && r[4].toLowerCase()!==sector || stage && !r[5].toLowerCase().includes(stage))continue;
            found.push(r);
          }
          if(!filtering && found.length>=page*24)break;
        }
        const n=filtering?found.length:meta.events,pages=Math.max(1,Math.ceil(n/24));page=Math.min(page,pages);
        const q=new URLSearchParams();for(const k of keys)if(form.elements[k].value)q.set(k,form.elements[k].value);
        if(page>1)q.set('page',page);history.replaceState(null,'','search.html'+(q.size?'?'+q:''));
        count.textContent=n.toLocaleString()+' 笔 · 第 '+page+' / '+pages+' 页';list.replaceChildren();
        for(const r of found.slice((page-1)*24,page*24)){
          const tr=document.createElement('tr'), company=document.createElement('th'), a=document.createElement('a');
          company.scope='row';a.href='deal.html?id='+r[0];a.textContent=r[1];company.append(a);tr.append(company);
          for(const value of [r[10],r[3],r[5],r[6],r[7].join('、'),r[8],[r[4],r[9]].filter(Boolean).join(' / ')]){
            tr.insertCell().textContent=value||'未记录';
          }
          list.append(tr);
        }
        document.querySelector('#prev').disabled=page<=1;document.querySelector('#next').disabled=page>=pages;
      }catch{if(seq===version)count.textContent='数据加载失败，请刷新重试。';}
    }
    function update(){page=1;version++;clearTimeout(timer);timer=setTimeout(show,200);}
    form.oninput=update;form.onreset=()=>setTimeout(update);form.onsubmit=e=>{e.preventDefault();update();};
    document.querySelector('#prev').onclick=()=>{page--;show();};document.querySelector('#next').onclick=()=>{page++;show();};
    show();
  }catch{count.textContent='索引加载失败，请刷新重试。';}
})();
