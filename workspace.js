const researchWorkspace=(()=>{
  const args=new URLSearchParams(location.search);
  const question=args.get('question')||'';
  const clientId=/^[a-f0-9]{24}$/.test(args.get('client')||'') ? args.get('client') : '';
  const title=document.querySelector('#work-title');
  const description=document.querySelector('#work-context');
  const summary=document.querySelector('#shortlist-summary');
  const count=document.querySelector('#shortlist-count');
  const items=document.querySelector('#shortlist-items');
  const empty=document.querySelector('#shortlist-empty');
  let client=null, excluded=new Set();
  if(clientId)title.textContent='正在读取服务项目…';
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
  try{
    const stored=JSON.parse(sessionStorage.getItem('guanshi-shortlist')||'[]');
    if(Array.isArray(stored))saved=stored.filter(item=>item && typeof item.href==='string');
  }catch{}
  // Institution detail links carry the active filters, but the record ID is stable.
  function itemKey(href){
    const url=new URL(href,location.href),id=url.searchParams.get('id');
    return id ? url.pathname+'?id='+id : url.href;
  }
  saved=[...new Map(saved.map(item=>[itemKey(item.href),item])).values()];
  function renderSaved(){
    count.textContent='已选 '+saved.length+' 项';
    items.hidden=!saved.length;
    empty.hidden=!!saved.length;
    const lines=saved.map(item=>{
      const line=document.createElement('li'), a=document.createElement('a');
      const copy=document.createElement('div'), reason=document.createElement('small');
      a.href=item.href;a.textContent=item.name;reason.textContent=item.reason;
      copy.append(a,reason);line.append(copy,pick(item,true));
      return line;
    });
    items.replaceChildren(...lines);
  }
  function updateButton(button,item,active,remove){
    const action=remove?'移出清单':active?'已加入':'加入清单';
    button.textContent=action;
    button.setAttribute('aria-label',action+(active&&!remove?'，点击移出':'')+' '+item.name);
    if(!remove)button.setAttribute('aria-pressed',String(active));
    button.title=active&&!remove?'点击移出清单':'';
  }
  function pick(item,remove=false){
    const key=itemKey(item.href), b=document.createElement('button');
    b.className='pick';b.type='button';b.dataset.key=key;
    updateButton(b,item,saved.some(i=>itemKey(i.href)===key),remove);
    b.onclick=()=>{
      const exists=saved.some(i=>itemKey(i.href)===key);
      saved=exists?saved.filter(i=>itemKey(i.href)!==key):[...saved,item];
      try{sessionStorage.setItem('guanshi-shortlist',JSON.stringify(saved));}catch{}
      renderSaved();
      for(const other of document.querySelectorAll('#matches .pick')){
        if(other.dataset.key===key)updateButton(other,item,!exists,false);
      }
      if(remove)summary.focus();
    };
    return b;
  }
  async function prepare(meta){
    interpret(meta);
    document.querySelector('.research-entry input').value=question;
    renderSaved();
    if(!clientId)return excluded;
    try{
      const response=await fetch('records/company-'+clientId.slice(0,2)+'.json');
      if(!response.ok)throw Error();
      client=(await response.json())[clientId];
      if(!client)throw Error();
      title.textContent=client.name;
      excluded=new Set(client.events.flatMap(event=>event[4].map(party=>party[0])));
    }catch{
      title.textContent='服务项目档案未能读取';
    }
    return excluded;
  }
  function scope({sector,sub,view,hasConditions}){
    if(!clientId){
      description.textContent=question?(hasConditions?'当前检索条件见下方，可直接修改。':'未识别出赛道、轮次或年份，可在下方选择条件。'):'';
      return '';
    }
    const selected=[sector,sub].filter(Boolean).join(' / ')||'全部赛道';
    const current='按「'+selected+'」检索。';
    if(!client){
      description.textContent=current+' 未能读取项目档案，未排除历史参投资方或相邻细分方向。';
      return '';
    }
    if(view!=='institutions'){
      description.textContent=current;
      return '';
    }
    const historical=excluded.size?'已排除本站记录中的项目历史资方。':'';
    const requested=args.get('adjacent');
    const direction=requested && (typeof sectorFilter==='undefined'?requested:sectorFilter.resolve(client.primary,requested).sub);
    const adjacent=!sub && sector===client.primary && client.hasFineDirection!==false && direction && direction===client.sub ? direction : '';
    if(adjacent){
      description.textContent=current+' 已排除「'+adjacent+'」及未标明细分方向的交易。'+historical;
    }else{
      const reason=requested||client.sub?'当前条件未触发相邻方向排除。':'项目细分方向待核实，未作相邻方向排除。';
      description.textContent=current+' '+reason+historical;
    }
    return adjacent;
  }
  function evidence(cell,href){
    const details=document.createElement('details'),summary=document.createElement('summary');
    summary.textContent='看公司与证据';details.append(summary);cell.append(details);
    let loading=false;
    details.ontoggle=async()=>{
      if(!details.open||loading)return;
      loading=true;
      const id=new URL(href,location.href).searchParams.get('id');
      const body=document.createElement('div');details.append(body);body.textContent='读取档案…';
      try{
        const response=await fetch('records/company-'+id.slice(0,2)+'.json');
        if(!response.ok)throw Error();
        const row=(await response.json())[id],claim=row.profile?.claims.find(c=>c.sources.length);
        body.textContent=claim?.text||row.sector||'产品资料待补充';
        if(row.profile?.question){const p=document.createElement('p');p.textContent=row.profile.question;body.append(p);}
        const source=claim?.sources[0]?.url||row.events[0]?.[5]?.[0];
        if(source){
          const a=document.createElement('a');a.href=source;a.target='_blank';a.rel='noopener';
          a.textContent=claim?'查看研究来源 ↗':'查看融资披露 ↗';body.append(document.createElement('br'),a);
        }
      }catch{body.textContent='档案读取失败，可点击公司名查看。';}
    };
  }
  return {args,prepare,scope,pick,evidence};
})();
