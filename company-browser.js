(()=>{
  const {el,link,timeline}=companyHistory;
  const root=document.querySelector('.company-catalog'),input=root.querySelector('input');
  const [select,sub]=root.querySelectorAll('select');
  const list=root.querySelector('#company-results'),status=root.querySelector('[role=status]');
  const [prev,next]=root.querySelectorAll('nav button'),cache=new Map();
  const params=new URLSearchParams(location.search);
  input.value=params.get('q')||'';
  const initial=sectorFilter.resolve(params.get('sector')||'',params.get('sub')||'');
  sectorFilter.setValue(select,initial.sector);
  let directionOptions={};
  let page=Math.max(1,Number.parseInt(params.get('page'))||1),version=0,timer;
  const normalize=value=>value.normalize('NFKC').trim().toLowerCase();
  function load(name){
    if(!cache.has(name))cache.set(name,fetch('records/'+name+'.json').then(r=>{if(!r.ok)throw Error();return r.json();}).catch(e=>{cache.delete(name);throw e;}));
    return cache.get(name);
  }
  function card([key,name,area,sector,day,stage,amount,parties,count,url]){
    const a=el('article');a.className='company-entry';
    const header=el('header'),h=el('h2');h.append(link('company.html?id='+key,name));header.append(h,el('small',[area,sector].filter(Boolean).join(' · ')));
    const main=el('div'),deal=link(url,[day,stage,amount].filter(Boolean).join(' · ')||'交易信息未列明');deal.className='company-deal';main.append(deal);
    if(parties.length){const p=el('p','投资方　');parties.forEach(([n,u],i)=>{if(i)p.append('、');p.append(link(u,n));});main.append(p);}
    const details=el('details');details.dataset.company=key;details.append(el('summary','交易记录 · '+count+' 笔'));a.append(header,main,details);return a;
  }
  list.addEventListener('toggle',async e=>{
    const d=e.target;if(!d.open||!d.dataset.company||d.dataset.busy)return;
    d.dataset.busy='1';const msg=el('p','正在读取…');d.append(msg);
    try{const k=d.dataset.company;const row=(await load('company-'+k.slice(0,2)))[k];msg.replaceWith(timeline(row));}
    catch{msg.textContent='读取失败，收起后可重试。';delete d.dataset.busy;d.addEventListener('toggle',()=>msg.remove(),{once:true});}
  },true);
  function showDirections(value=''){
    const options=select.value?directionOptions[select.value]||[]:[...new Set(Object.values(directionOptions).flat())].sort();
    sub.replaceChildren(new Option('全部方向',''),...options.map(n=>new Option(n,n)));
    sectorFilter.setValue(sub,value);
  }
  showDirections(initial.sub);
  load('company-directions').then(data=>{directionOptions=data;showDirections(sub.value);}).catch(()=>{});
  async function show(){
    const seq=++version,q=normalize(input.value),s=select.value,d=sub.value;
    const request=sectorFilter.resolve(s,d);
    try{
      let ids,total=Number(root.dataset.total);
      if(q||s||d){const index=await load('company-lookup');ids=[];index.forEach(([name,aliases,,filters],i)=>{
        if((!s&&!d||filters.some(path=>sectorFilter.matches(request,...path)))&&
           (!q||[name,...aliases].some(n=>normalize(n).includes(q))))ids.push(i);
      });total=ids.length;}
      if(seq!==version)return;
      const pages=Math.max(1,Math.ceil(total/30));page=Math.min(page,pages);
      const start=(page-1)*30,selection=ids?ids.slice(start,start+30):Array.from({length:Math.min(30,total-start)},(_,i)=>start+i);
      const rows=await Promise.all(selection.map(async i=>(await load('company-summary-'+Math.floor(i/30)))[i%30]));
      if(seq!==version)return;
      list.replaceChildren(...rows.map(card));status.textContent=total?total.toLocaleString()+' 份档案 · 最近交易优先':'没有匹配的公司';
      prev.disabled=page<=1;next.disabled=page>=pages;
      const url=new URLSearchParams();if(q)url.set('q',input.value.trim());if(s)url.set('sector',s);if(d)url.set('sub',d);if(page>1)url.set('page',page);
      history.replaceState(null,'','companies.html'+(url.size?'?'+url:''));
    }catch{if(seq===version)status.textContent='加载失败，请刷新重试。';}
  }
  function filter(){page=1;version++;clearTimeout(timer);timer=setTimeout(show,150);}
  input.oninput=filter;sub.onchange=filter;select.onchange=()=>{showDirections();filter();};
  prev.onclick=()=>{page--;show();root.scrollIntoView();};next.onclick=()=>{page++;show();root.scrollIntoView();};
  if(input.value||select.value||sub.value||page>1)show();else next.disabled=Number(root.dataset.total)<=30;
})();
