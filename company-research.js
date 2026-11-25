(()=>{
  const byId=id=>document.getElementById(id), input=byId('company-query'),status=byId('desk-status');
  const normalize=name=>name.normalize('NFKC').trim().toLowerCase();
  const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
  function link(text,url){const a=node('a',text);a.href=url;return a;}
  function line(parent,...children){const p=document.createElement('p');p.append(...children);parent.append(p);}
  const cache=new Map();
  function load(key){
    if(!cache.has(key))cache.set(key,fetch('records/'+key+'.json').then(res=>{
      if(!res.ok)throw Error();return res.json();
    }).catch(e=>{cache.delete(key);throw e;}));
    return cache.get(key);
  }
  const research=id=>'company-research.html?id='+encodeURIComponent(id);
  let version=0;
  async function show(id){
    const seq=++version;
    byId('company-board').hidden=true;byId('choices').replaceChildren();status.textContent='正在读取公司档案…';
    try{
      if(!/^[0-9a-f]{24}$/.test(id))throw Error();
      const row=(await load('company-'+id.slice(0,2)))[id];if(!row)throw Error();
      if(seq!==version)return;
      input.value='';input.placeholder='查找其他公司';byId('subject').textContent=row.name;document.title=row.name+' · 公司研究台 · 观势';
      byId('classification').textContent=[row.location,row.primary,row.sub].filter(Boolean).join(' / ');
      const study=byId('api-study');
      if(study?.dataset.company===id){
        study.hidden=false;
        byId('company-board').classList.add('api-mode');
        byId('company-board').hidden=false;status.textContent='';
        const archive=link('查看公司融资档案 →','company.html?id='+id);study.append(archive);
        return;
      }
      const [product,capital,backers,peers,questions]=['product','capital','backers','peers','questions'].map(byId);
      for(const panel of [product,capital,backers,peers,questions])panel.replaceChildren();
      const claim=row.profile?.claims.find(c=>c.sources?.length);
      line(product,claim?.text||('主营方向'+(row.sub||row.primary?'为'+(row.sub||row.primary):'待核实')+'。产品和客户进展尚待补证。'));
      const latest=byId('latest');latest.replaceChildren();
      const event=row.events[0];
      if(event){
        line(latest,'轮次 / 类型　'+(event[2]||'未记录'));
        latest.append(node('strong','披露金额　'+(event[3]||'未记录')));
        line(latest,link(event[1]||'查看融资记录',event[0]));
        if(event[4].length)line(latest,event[4].slice(0,3).map(p=>p[0]).join('、')+(event[4].length>3?' 等':''));
      }else line(latest,'尚无收录记录。');
      if(claim)for(const s of claim.sources)line(product,link(s.title,s.url));
      const claims=row.profile?.claims.filter(c=>c.sources?.length)||[];
      if(claims.length>1 || claim?.limits?.length){
        const evidence=node('details','');evidence.append(node('summary','更多研究与证据边界'));
        for(const c of claims){
          if(c!==claim){line(evidence,c.text);for(const src of c.sources)line(evidence,link(src.title,src.url));}
          for(const limit of c.limits||[])line(evidence,limit);
        }
        product.append(evidence);
      }
      for(const [url,date,stage,amount] of row.events.slice(0,4))line(capital,link([date,stage,amount].filter(Boolean).join(' · ')||'融资记录',url));
      line(capital,link('完整公司档案 · '+row.events.length+' 笔','company.html?id='+id));
      const names=new Map(row.events.flatMap(e=>e[4]));
      if(!names.size)line(backers,'收录的融资记录尚未列明投资机构。');
      for(const [name,url] of [...names].slice(0,6))line(backers,link(name,url));
      if(row.primary){
        const args=new URLSearchParams({view:'institutions',sector:row.primary,client:id});
        if(row.sub)args.set('adjacent',row.sub);
        byId('buyers').replaceChildren();
        line(byId('buyers'),link('查看相邻方向投资案例 →','workspace.html?'+args));
      }
      line(questions,row.profile?.question||'哪些客户已付费或完成验收？能否取得合同、复购或交付证据？');
      if(!row.profile?.question)questions.prepend(node('small','通用访谈问题'));
      byId('company-board').hidden=false;status.textContent='';
      try{
        const topics=await load('research-topics'),key=topics[row.primary]?.[row.sub];
        const matches=key?(await load('peers-'+key)).filter(r=>r[0]!=='company.html?id='+id):[];
        if(seq!==version)return;
        const buyers=byId('buyers'),used=new Set(names.keys()),cases=[];
        for(const [href,name,date,stage,amount,dealHref,parties] of matches){
          if(peers.children.length<3){
            const block=node('div','');block.className='research-case';
            block.append(link(name,research(new URL(href,location.href).searchParams.get('id'))),
              node('small',[row.sub,date,stage].filter(Boolean).join(' · ')),link('披露金额　'+(amount||'未记录'),dealHref));
            peers.append(block);
          }
          for(const [inst,url] of parties||[]){
            if(used.has(inst)||cases.length>=3)continue;
            used.add(inst);
            const block=node('div','');block.className='research-case';
            block.append(link(inst,url+'&'+new URLSearchParams({sector:row.primary,sub:row.sub})),
              node('small','同方向投资案例'),link([name,date,stage].filter(Boolean).join(' · '),dealHref));
            cases.push(block);
            break;
          }
        }
        if(cases.length){
          buyers.prepend(...cases);line(buyers,node('small','接洽前核实竞品关系及当前投资意向。'));
        }else buyers.prepend(node('p','当前同行样本尚未提供可与本公司已披露资方区分的机构案例。'));
        if(!matches.length)line(peers,'暂无可按同一细分方向列出的其他公司。');
        if(row.sub)line(peers,link('查看同方向公司 →','workspace.html?'+new URLSearchParams({view:'companies',sector:row.primary,sub:row.sub})));
      }catch{if(seq===version){line(peers,'同行资料暂时无法加载。');line(byId('buyers'),'同方向机构案例暂时无法加载。');}}
    }catch{if(seq===version)status.textContent='公司档案暂时无法读取，请重新搜索。';}
  }
  byId('company-finder').onsubmit=async e=>{
    e.preventDefault();const q=normalize(input.value);if(!q)return;
    const seq=++version;status.textContent='正在查找…';byId('choices').replaceChildren();byId('company-board').hidden=true;
    try{
      const index=await load('company-lookup'),hits=[];
      index.forEach(([name,aliases],i)=>{
        const names=[name,...aliases].map(normalize);
        if(names.some(n=>n.includes(q)))hits.push({i,exact:names.includes(q)});
      });
      hits.sort((a,b)=>Number(b.exact)-Number(a.exact));
      const rows=await Promise.all(hits.slice(0,12).map(async h=>(await load('company-summary-'+Math.floor(h.i/30)))[h.i%30]));
      if(seq!==version)return;
      if(rows.length===1||hits[0]?.exact&&!hits[1]?.exact){location.assign(research(rows[0][0]));return;}
      status.textContent=hits.length?'找到 '+hits.length+' 家，请选择公司'+(hits.length>12?'（显示前 12 家）':''):'没有匹配公司，请尝试简称或更短的关键词。';
      for(const [id,name,region,sector] of rows)byId('choices').append(link([name,region,sector].filter(Boolean).join(' · '),research(id)));
    }catch{if(seq===version)status.textContent='搜索索引暂时无法读取，请重试。';}
  };
  const id=new URLSearchParams(location.search).get('id');
  if(!id){const label=node('small','示例公司');byId('subject').before(label);}
  show(id||'f47ef648ab8c198592a47f10');
})();
