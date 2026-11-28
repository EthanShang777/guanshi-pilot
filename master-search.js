(async()=>{
  const form=document.querySelector('#archive-form'), count=document.querySelector('#match-count'),list=document.querySelector('#matches');
  const keys=['company','investor','sector','year','stage','sub','mode','view'];
  const load=async name=>{const res=await fetch('records/'+name+'.json');if(!res.ok)throw Error();return res.json();};
  if(typeof faMatching!=='undefined' && new URLSearchParams(location.search).has('project')){
    await faMatching.start({form,count,list,load});
    return;
  }
  try{
    const work=typeof researchWorkspace!=='undefined'?researchWorkspace:null;
    const meta=await load('manifest'),args=work?.args||new URLSearchParams(location.search),cache=new Map();
    if(!work){
      const extra=document.createElement('details'),label=document.createElement('summary');label.textContent='更多条件';extra.append(label);
      for(const key of ['sub','stage','mode'])extra.append(form.elements[key].closest('label'));
      form.append(extra);extra.open=['sub','stage','mode'].some(k=>args.get(k));
    }
    const excluded=work?await work.prepare(meta):new Set();
    const route=work?'workspace.html':'search.html';
    for(const [key,items] of [['year',meta.years],['sector',meta.sectors]])for(const s of items)form.elements[key].add(new Option(s,s));
    function directions(sector){
      const select=form.elements.sub;
      const options=sector ? meta.subs[sector]||[] : [...new Set(Object.values(meta.subs).flat())].sort();
      select.replaceChildren(new Option('全部方向',''),...options.map(n=>new Option(n,n)));
    }
    const legacyProject = work && args.get('client') && args.get('sector') === '机器人' && !args.get('sub') && !args.get('adjacent');
    const initial=sectorFilter.resolve(legacyProject?'机器人与自动化':args.get('sector')||'',args.get('sub')||'');
    directions(initial.sector);
    const nameKey=s=>s.normalize('NFKC').replace(/\s/g,'').toLowerCase();
    const aliases=meta.institutionAliases||{};
    const matchesInvestor=(name,query)=>nameKey(name).includes(query)||
      (Object.hasOwn(aliases,name)&&aliases[name].some(alias=>nameKey(alias).includes(query)));
    form.elements.sector.addEventListener('input',()=>directions(form.elements.sector.value));
    const table=list.closest('table'), headings=table.tHead.rows[0], original=headings.cloneNode(true);
    const columns=document.createElement('colgroup');
    for(let i=0;i<4;i++)columns.append(document.createElement('col'));
    if(work)table.parentElement.setAttribute('aria-busy','true');
    const normalize=s=>s.toLowerCase().replace(/series|轮|融资|[\s-]/g,'');
    const family=s=>normalize(s).replace(/^pre/,'').replace(/[+0-9]+$/,'');
    function matchRound(value, query, mode){
      if(!query)return true;
      if(mode==='exact')return normalize(value)===normalize(query);
      if(mode==='family')return family(value)===family(query);
      return value.toLowerCase().includes(query);
    }
    function anchor(title,href){const a=document.createElement('a');a.textContent=title;a.href=href;return a;}
    function latestCase(cell,row){
      cell.className='latest-case';
      const link=anchor(row[1],'deal.html?id='+row[0]);
      link.className='case-name';cell.append(link);
      const facts=document.createElement('small');facts.className='case-facts';
      if(row[3]){
        const day=document.createElement('time');day.className='case-date';day.textContent=row[3];
        if(/^\d{4}(?:-\d{2}){0,2}$/.test(row[3]))day.dateTime=row[3];
        facts.append(day);
      }
      if(row[5]){
        const stage=document.createElement('span');stage.className='case-round';stage.textContent=row[5];facts.append(stage);
      }
      if(facts.childElementCount)cell.append(facts);
    }
    function formatMoney(cell){
      const text=cell.textContent;
      const amount=/(?:[A-Z]{0,3}[$€£¥]\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?: *万亿| *[亿万千])?(?: *(?:人民币|美元|欧元|日元|港元|港币|英镑|韩元|加元|澳元|元|million|billion))?/gi;
      let pos=0;
      cell.replaceChildren();cell.className='money';
      for(const match of text.matchAll(amount)){
        const unit=document.createElement('span');unit.textContent=match[0];
        cell.append(text.slice(pos,match.index),unit);
        pos=match.index+match[0].length;
      }
      cell.append(text.slice(pos));
    }
    keys.filter(k=>!['sector','sub'].includes(k)).forEach(k=>form.elements[k].value=args.get(k)||'');
    sectorFilter.setValue(form.elements.sector,initial.sector);
    sectorFilter.setValue(form.elements.sub,initial.sub);
    let page=Math.max(1,parseInt(args.get('page'))||1),version=0,timer;
    async function show(){
      const seq=++version, values=keys.map(k=>form.elements[k].value.trim().toLowerCase());
      const [company,investor,sector,year,stage,sub,mode,view]=values;
      const filtering=values.some(Boolean), found=[];
      const scope=sectorFilter.resolve(form.elements.sector.value,form.elements.sub.value);
      const investorQuery=nameKey(investor);
      const adjacent=work?.scope({...scope,view,hasConditions:Boolean(company||investor||scope.sector||scope.sub||year||stage)});
      if(work)table.parentElement.setAttribute('aria-busy','true');
      count.textContent='正在检索…';
      try{
        for(const y of year?[form.elements.year.value]:meta.years){
          if(!cache.has(y))cache.set(y,load('search-'+y).catch(e=>{cache.delete(y);throw e;}));
          const rows=await cache.get(y);if(seq!==version)return;
          for(const r of rows){
            if(![r[1],...r[2]].some(n=>n.trim().toLowerCase().includes(company)) ||
               investorQuery && !r[7].some(n=>matchesInvestor(n,investorQuery)) ||
               !sectorFilter.matches(scope,r[4],r[9]||'',r[12]) || !matchRound(r[5]||'',stage,mode))continue;
            if(adjacent && (!r[9]||r[9]===adjacent))continue;
            found.push(r);
          }
          if(!filtering && found.length>=page*24)break;
        }
        const grouped=new Map();
        if(view)for(const r of found){
          const parties=view==='companies'?[[r[11],r[1]]]:r[7].map(n=>[n,n]);
          for(const [key,name] of parties){
            if(view==='institutions' && (excluded.has(name) || investorQuery && !matchesInvestor(name,investorQuery)))continue;
            if(!grouped.has(key))grouped.set(key,{name,key,rows:[],companies:new Set()});
            const group=grouped.get(key);group.rows.push(r);group.companies.add(r[11]);
          }
        }
        const groups=[...grouped.values()].sort((a,b)=>b.companies.size-a.companies.size||b.rows.length-a.rows.length);
        const n=view?groups.length:filtering?found.length:meta.events,pages=Math.max(1,Math.ceil(n/24));page=Math.min(page,pages);
        const q=new URLSearchParams();for(const k of keys)if(form.elements[k].value)q.set(k,form.elements[k].value);
        if(work)for(const key of ['question','client','adjacent'])if(args.has(key))q.set(key,args.get(key));
        if(page>1)q.set('page',page);history.replaceState(null,'',route+(q.size?'?'+q:''));
        const type=view==='companies'?'公司':view==='institutions'?'机构':'交易';
        const filters=keys.filter(k=>!['view','mode'].includes(k)).map(k=>form.elements[k].value).filter(Boolean).join(' · ');
        const resultText=(n ? n.toLocaleString()+(view?' 家'+type:' 笔交易')+' · 第 '+page+' / '+pages+' 页' : '没有匹配的'+type)+(!work&&filters?'　'+filters:'');
        list.replaceChildren();
        if(work){
          table.classList.toggle('grouped-results',!!view);
          if(view)table.prepend(columns);else columns.remove();
        }
        headings.replaceChildren(...[...original.cells].map(c=>c.cloneNode(true)));
        if(view){
          headings.replaceChildren();
          for(const title of [view==='companies'?'公司':'机构','匹配交易','最近案例',...(work?['清单']:[])]){
            const th=document.createElement('th');th.scope='col';th.textContent=title;headings.append(th);
          }
          for(const g of groups.slice((page-1)*24,page*24)){
            const r=g.rows[0];
            let href=g.key;
            if(view==='institutions'){
              const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('institution'+g.name));
              if(seq!==version)return;
              const id=Array.from(new Uint8Array(digest).slice(0,12),v=>v.toString(16).padStart(2,'0')).join('');
              href='institution.html?'+new URLSearchParams({id,sector:form.elements.sector.value,sub:form.elements.sub.value});
            }
            const tr=list.insertRow(), nameCell=document.createElement('th');
            nameCell.scope='row';nameCell.append(anchor(g.name,href));tr.append(nameCell);
            if(work && view==='companies')work.evidence(nameCell,href);
            const matches=tr.insertCell();matches.textContent=g.rows.length+' 笔';
            if(view==='institutions'){
              if(work){
                const companyCount=document.createElement('span');companyCount.textContent=g.companies.size+' 家公司';matches.append(companyCount);
              }else matches.append(' · '+g.companies.size+' 家公司');
            }
            const latest=tr.insertCell();
            if(work)latestCase(latest,r);
            else latest.append(anchor([r[1],r[3],r[5]].filter(Boolean).join(' · '),'deal.html?id='+r[0]));
            if(work)tr.insertCell().append(work.pick({name:g.name,href,reason:[r[9],r[1],r[5],r[3]].filter(Boolean).join(' · ')}));
          }
        }else for(const r of found.slice((page-1)*24,page*24)){
          const tr=document.createElement('tr'), company=document.createElement('th'), a=document.createElement('a');
          company.scope='row';a.href='deal.html?id='+r[0];a.textContent=r[1];company.append(a);tr.append(company);
          for(const value of [r[10],r[3],r[5],r[6],r[7].join('、'),r[8],[r[4],r[9]].filter(Boolean).join(' / ')]){
            tr.insertCell().textContent=value||'未记录';
          }
          if(work){
            formatMoney(tr.cells[4]);formatMoney(tr.cells[6]);
            if(r[7].length)tr.cells[5].replaceChildren(...r[7].map((name,index)=>{
              const party=document.createElement('span');party.className='party-name';
              party.textContent=name+(index===r[7].length-1?'':'、');return party;
            }));
          }
          if(r[9]){
            const next=new URLSearchParams(q);next.delete('page');next.set('sector',r[4]);next.set('sub',r[9]);
            tr.lastElementChild.replaceChildren(document.createTextNode(r[4]+' / '),anchor(r[9],route+'?'+next));
          }
          list.append(tr);
        }
        document.querySelector('#prev').disabled=page<=1;document.querySelector('#next').disabled=page>=pages;
        count.textContent=resultText;
        if(work)table.parentElement.hidden=!n;
      }catch{if(seq===version)count.textContent='数据加载失败，请刷新重试。';}
      finally{if(work&&seq===version)table.parentElement.setAttribute('aria-busy','false');}
    }
    function update(){page=1;version++;clearTimeout(timer);timer=setTimeout(show,200);}
    form.oninput=update;form.onreset=()=>{
      const display=form.elements.view.value;
      setTimeout(()=>{if(work)form.elements.view.value=display;directions('');update();});
    };form.onsubmit=e=>{e.preventDefault();update();};
    document.querySelector('#prev').onclick=()=>{page--;show();};document.querySelector('#next').onclick=()=>{page++;show();};
    show();
  }catch{count.textContent='索引加载失败，请刷新重试。';}
})();
