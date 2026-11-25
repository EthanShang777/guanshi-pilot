const researchWorkspace=(()=>{
  const args=new URLSearchParams(location.search);
  const question=args.get('question')||'';
  const notes=[];
  function interpret(meta){
    if(!question||args.has('view'))return;
    const topics=Object.entries(meta.subs).flatMap(([sector,subs])=>subs.map(sub=>({sector,sub})));
    const topic=topics.filter(t=>question.includes(t.sub)).sort((a,b)=>b.sub.length-a.sub.length)[0];
    const sector=topic?.sector||meta.sectors.find(s=>question.includes(s));
    if(sector)args.set('sector',sector);
    if(topic)args.set('sub',topic.sub);
    const year=question.match(/20\d{2}/)?.[0]||(question.includes('今年')?String(new Date().getFullYear()):'');
    if(meta.years.includes(year))args.set('year',year);
    const stage=question.match(/(?:pre[- ]?)?[a-f](?:\+{1,3}|\d)?\s*轮|种子轮|天使轮/i)?.[0];
    if(stage){args.set('stage',stage);args.set('mode','exact');}
    args.set('view',/机构|资方|投资方/.test(question)?'institutions':'companies');
  }
  let saved=[];
  try{saved=JSON.parse(sessionStorage.getItem('guanshi-shortlist')||'[]');}catch{}
  function renderSaved(){
    const box=document.querySelector('#shortlist');box.replaceChildren();
    if(!saved.length)return;
    const title=document.createElement('h2');title.textContent='已选清单 · '+saved.length;box.append(title);
    for(const item of saved){
      const line=document.createElement('p'),a=document.createElement('a');a.href=item.href;a.textContent=item.name;
      line.append(a,'　'+item.reason+'　',pick(item));box.append(line);
    }
  }
  function pick(item){
    const b=document.createElement('button');b.className='pick';b.type='button';b.dataset.key=item.href;
    const active=saved.some(i=>i.href===item.href);b.textContent=active?'移出清单':'加入清单';b.setAttribute('aria-pressed',String(active));
    b.onclick=()=>{
      const exists=saved.some(i=>i.href===item.href);
      saved=exists?saved.filter(i=>i.href!==item.href):[...saved,item];
      try{sessionStorage.setItem('guanshi-shortlist',JSON.stringify(saved));}catch{}
      renderSaved();
      for(const other of document.querySelectorAll('.pick'))if(other.dataset.key===item.href){other.setAttribute('aria-pressed',String(!exists));other.textContent=exists?'加入清单':'移出清单';}
    };return b;
  }
  async function prepare(meta){
    interpret(meta);
    document.querySelector('.research-entry input').value=question;
    const context=document.querySelector('#work-context');
    if(question)notes.push('已应用的检索条件见下方，可直接修改。地域、投资意向及竞争关系需另行核实。');
    let client=null;
    const id=args.get('client');
    if(/^[a-f0-9]{24}$/.test(id||'')){
      const response=await fetch('records/company-'+id.slice(0,2)+'.json');
      if(!response.ok)throw Error();
      client=(await response.json())[id];if(!client)throw Error();
      notes.push('服务项目：'+client.name+'。机构结果已排除本站收录的该公司历次参投资方；相邻方向按同一级赛道的其他细分方向筛选。');
    }
    context.textContent=notes.join(' ');renderSaved();
    return new Set(client?.events.flatMap(e=>e[4].map(i=>i[0]))||[]);
  }
  return {args,prepare,pick};
})();
