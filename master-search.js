(async()=>{
  const form=document.querySelector('#archive-form'), count=document.querySelector('#match-count'),list=document.querySelector('#matches');
  const keys=['company','investor','sector','year','stage','sub','mode','view'];
  const load=async name=>{const res=await fetch('records/'+name+'.json');if(!res.ok)throw Error();return res.json();};
  try{
    const work=typeof researchWorkspace!=='undefined'?researchWorkspace:null;
    const meta=await load('manifest'),args=work?.args||new URLSearchParams(location.search),cache=new Map();
    const excluded=work?await work.prepare(meta):new Set();
    const route=work?'workspace.html':'search.html';
    for(const [key,items] of [['year',meta.years],['sector',meta.sectors]])for(const s of items)form.elements[key].add(new Option(s,s));
    function directions(sector){
      const select=form.elements.sub;
      const options=sector ? meta.subs[sector]||[] : [...new Set(Object.values(meta.subs).flat())].sort();
      select.replaceChildren(new Option('全部方向',''),...options.map(n=>new Option(n,n)));
    }
    directions(args.get('sector'));
    form.elements.sector.addEventListener('input',()=>directions(form.elements.sector.value));
    const table=list.closest('table'), headings=table.tHead.rows[0], original=headings.cloneNode(true);
    const normalize=s=>s.toLowerCase().replace(/series|轮|融资|[\s-]/g,'');
    const family=s=>normalize(s).replace(/^pre/,'').replace(/[+0-9]+$/,'');
    function matchRound(value, query, mode){
      if(!query)return true;
      if(mode==='exact')return normalize(value)===normalize(query);
      if(mode==='family')return family(value)===family(query);
      return value.toLowerCase().includes(query);
    }
    function anchor(title,href){const a=document.createElement('a');a.textContent=title;a.href=href;return a;}
    keys.forEach(k=>form.elements[k].value=args.get(k)||'');
    let page=Math.max(1,parseInt(args.get('page'))||1),version=0,timer;
    async function show(){
      const seq=++version, values=keys.map(k=>form.elements[k].value.trim().toLowerCase());
      const [company,investor,sector,year,stage,sub,mode,view]=values;
      const filtering=values.some(Boolean), found=[];
      count.textContent='正在检索…';
      try{
        for(const y of year?[form.elements.year.value]:meta.years){
          if(!cache.has(y))cache.set(y,load('search-'+y).catch(e=>{cache.delete(y);throw e;}));
          const rows=await cache.get(y);if(seq!==version)return;
          for(const r of rows){
            if(![r[1],...r[2]].some(n=>n.toLowerCase().includes(company)) || investor && !r[7].some(n=>n.toLowerCase().includes(investor)) ||
               sector && r[4].toLowerCase()!==sector || sub && (r[9]||'').toLowerCase()!==sub || !matchRound(r[5]||'',stage,mode))continue;
            if(view==='institutions' && args.get('adjacent') && (!r[9]||r[9]===args.get('adjacent')))continue;
            found.push(r);
          }
          if(!filtering && found.length>=page*24)break;
        }
        const grouped=new Map();
        if(view)for(const r of found){
          const parties=view==='companies'?[[r[11],r[1]]]:r[7].map(n=>[n,n]);
          for(const [key,name] of parties){
            if(view==='institutions' && excluded.has(name))continue;
            if(!grouped.has(key))grouped.set(key,{name,key,rows:[],companies:new Set()});
            const group=grouped.get(key);group.rows.push(r);group.companies.add(r[11]);
          }
        }
        const groups=[...grouped.values()].sort((a,b)=>b.companies.size-a.companies.size||b.rows.length-a.rows.length);
        const n=view?groups.length:filtering?found.length:meta.events,pages=Math.max(1,Math.ceil(n/24));page=Math.min(page,pages);
        const q=new URLSearchParams();for(const k of keys)if(form.elements[k].value)q.set(k,form.elements[k].value);
        if(work)for(const key of ['question','client','adjacent'])if(args.has(key))q.set(key,args.get(key));
        if(page>1)q.set('page',page);history.replaceState(null,'',route+(q.size?'?'+q:''));
        count.textContent=n.toLocaleString()+(view?' 家':' 笔')+' · 第 '+page+' / '+pages+' 页';list.replaceChildren();
        headings.replaceChildren(...[...original.cells].map(c=>c.cloneNode(true)));
        if(view){
          headings.replaceChildren();
          for(const title of [view==='companies'?'公司':'机构','匹配交易','最近案例',...(work?['清单']:[])]){
            const th=document.createElement('th');th.textContent=title;headings.append(th);
          }
          for(const g of groups.slice((page-1)*24,page*24)){
            const tr=list.insertRow(),r=g.rows[0];
            let href=g.key;
            if(view==='institutions'){
              const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('institution'+g.name));
              if(seq!==version)return;
              const id=Array.from(new Uint8Array(digest).slice(0,12),v=>v.toString(16).padStart(2,'0')).join('');
              href='institution.html?'+new URLSearchParams({id,sector:form.elements.sector.value,sub:form.elements.sub.value});
            }
            tr.insertCell().append(anchor(g.name,href));
            tr.insertCell().textContent=g.rows.length+' 笔'+(view==='institutions'?' · '+g.companies.size+' 家公司':'');
            tr.insertCell().append(anchor([r[1],r[3],r[5]].filter(Boolean).join(' · '),'deal.html?id='+r[0]));
            if(work)tr.insertCell().append(work.pick({name:g.name,href,reason:[r[9],r[1],r[5],r[3]].filter(Boolean).join(' · ')}));
          }
        }else for(const r of found.slice((page-1)*24,page*24)){
          const tr=document.createElement('tr'), company=document.createElement('th'), a=document.createElement('a');
          company.scope='row';a.href='deal.html?id='+r[0];a.textContent=r[1];company.append(a);tr.append(company);
          for(const value of [r[10],r[3],r[5],r[6],r[7].join('、'),r[8],[r[4],r[9]].filter(Boolean).join(' / ')]){
            tr.insertCell().textContent=value||'未记录';
          }
          if(r[9]){
            const next=new URLSearchParams(q);next.delete('page');next.set('sector',r[4]);next.set('sub',r[9]);
            tr.lastElementChild.replaceChildren(document.createTextNode(r[4]+' / '),anchor(r[9],route+'?'+next));
          }
          list.append(tr);
        }
        document.querySelector('#prev').disabled=page<=1;document.querySelector('#next').disabled=page>=pages;
      }catch{if(seq===version)count.textContent='数据加载失败，请刷新重试。';}
    }
    function update(){page=1;version++;clearTimeout(timer);timer=setTimeout(show,200);}
    form.oninput=update;form.onreset=()=>setTimeout(()=>{directions('');update();});form.onsubmit=e=>{e.preventDefault();update();};
    document.querySelector('#prev').onclick=()=>{page--;show();};document.querySelector('#next').onclick=()=>{page++;show();};
    show();
  }catch{count.textContent='索引加载失败，请刷新重试。';}
})();
