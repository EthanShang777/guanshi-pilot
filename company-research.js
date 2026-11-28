(()=>{
  const byId=id=>document.getElementById(id), input=byId('company-query'),status=byId('desk-status');
  const normalize=name=>name.normalize('NFKC').trim().toLowerCase();
  const nameKey=name=>normalize(name).replace(/\s+/g,'').replace(/\((?:独家领投|共同领投|联合领投|领投|跟投|参投|追加|追加投资|追投|续投)\)$/u,'');
  const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
  let activeProject;
  function link(text,url){const a=node('a',text);a.href=activeProject?faNavigation.contextHref(url,activeProject):url;return a;}
  if(typeof faNavigation!=='undefined')faNavigation.currentProject().then(project=>{
    if(project){
      activeProject=project;
      document.querySelector('main.desk').prepend(faNavigation.projectBar(project));
      for(const anchor of document.querySelectorAll('main.desk a'))anchor.href=faNavigation.contextHref(anchor.href,project);
    }
  });
  function line(parent,...children){const p=document.createElement('p');p.append(...children);parent.append(p);}
  const studyContract=byId('generated-study').dataset;
  const sections=JSON.parse(studyContract.sections);
  const institutions=new Map(Object.entries(JSON.parse(studyContract.institutions)).flatMap(([name,aliases])=>
    aliases.map(alias=>[nameKey(alias),nameKey(name)])));
  const institutionKey=name=>institutions.get(nameKey(name))||nameKey(name);
  const nonFinancing=new Set(['股权转让','介绍上市','拟增资']);
  const gaps={
    '市场规模':'现有研究档案缺少已核对的产品边界、地区、期间及可复算的成交或测算依据。',
    '市场痛点':'现有研究档案缺少按具体买方、工作场景和原流程核对的痛点证据。',
    '核心团队':'缺少能核对关键人员任职与交付责任的材料。',
    '核心技术/产品':'缺少能核对关键功能、部署和使用成效的材料。',
    '友商对比':'缺少能够按同一口径比较产品或替代方案的材料。',
    '历史融资情况':'缺少可回查的历史融资或参投披露。',
    '机构类似布局':'缺少具名机构、其他被投公司及对应交易来源。',
    '新增潜在机构':'缺少同时支持可比投资、阶段、地域和新进身份的材料。接洽前还需核对出资规模与竞品冲突。',
  };
  function showGap(parent,text){
    const gap=node('p','');gap.className='research-gap';gap.append(node('strong','证据缺口'), ' '+text);parent.append(gap);
  }
  const cache=new Map();
  function load(key){
    if(!cache.has(key))cache.set(key,fetch('records/'+key+'.json').then(res=>{
      if(!res.ok)throw Error();return res.json();
    }).catch(e=>{cache.delete(key);throw e;}));
    return cache.get(key);
  }
  const research=id=>{
    const href='company-research.html?id='+encodeURIComponent(id);
    return activeProject?faNavigation.contextHref(href,activeProject):href;
  };
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
      const [product,capital,backers,peers,cases,buyers,questions]=
        ['product','capital','backers','peers','institution-cases','buyers','questions'].map(byId);
      const marketSize=byId('market-size'), marketPain=byId('market-pain');
      for(const panel of [product,capital,backers,peers,cases,buyers,questions,marketSize,marketPain])panel.replaceChildren();
      showGap(marketSize,gaps['市场规模']);
      showGap(marketPain,gaps['市场痛点']);
      showGap(buyers,gaps['新增潜在机构']);
      const claim=row.profile?.claims?.find(c=>c.sources?.length);
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
      const claims=row.profile?.claims?.filter(c=>c.sources?.length)||[];
      if(claims.length>1 || claim?.limits?.length){
        const evidence=node('details','');evidence.append(node('summary','更多研究与证据边界'));
        for(const c of claims){
          if(c!==claim){line(evidence,c.text);for(const src of c.sources)line(evidence,link(src.title,src.url));}
          for(const limit of c.limits||[])line(evidence,limit);
        }
        product.append(evidence);
      }
      const financing=row.events.filter(e=>!nonFinancing.has(e[2]));
      for(const [url,date,stage,amount,parties,sources] of financing.slice(0,4)){
        line(capital,link([date,stage,amount].filter(Boolean).join(' · ')||'融资记录',url));
        if(parties.length && sources.length){
          const names=parties.map(([name,href])=>link(name,href));
          line(capital,'已披露参投 ',...names.flatMap((name,i)=>i?['、',name]:[name]));
        }
      }
      line(capital,link('完整公司档案 · '+row.events.length+' 笔交易','company.html?id='+id));
      if(!financing.some(e=>e[4].length && e[5].length))showGap(backers,gaps['历史融资情况']);
      if(row.primary && row.primary!=='待归类'){
        const args=new URLSearchParams({view:'institutions',sector:row.primary,client:id});
        if(row.sub)args.set('adjacent',row.sub);
        line(buyers,link(row.sub?'查找相邻方向投资方 →':'查看同一大类的投资方 →','workspace.html?'+args));
      }
      line(questions,row.profile?.question||'哪些客户已付费或完成验收？能否取得合同、复购或交付证据？');
      if(!row.profile?.question)questions.prepend(node('small','通用访谈问题'));
      byId('company-board').hidden=false;status.textContent='';
      try{
        const topics=await load('research-topics'),key=topics[row.primary]?.[row.sub];
        const matches=key?(await load('peers-'+key)).filter(r=>r[0]!=='company.html?id='+id):[];
        if(seq!==version)return;
        const used=new Set();
        for(const [href,name,date,stage,amount,dealHref,parties] of matches){
          if(peers.children.length<3){
            const block=node('div','');block.className='research-case';
            block.append(link(name,research(new URL(href,location.href).searchParams.get('id'))),
              node('small',[row.sub,date,stage].filter(Boolean).join(' · ')),link('披露金额　'+(amount||'未记录'),dealHref));
            peers.append(block);
          }
          for(const [inst,url] of parties||[]){
            if(used.has(url)||used.size>=3)continue;
            used.add(url);
            const block=node('div','');block.className='research-case';
            block.append(link(inst,url),node('small','同属「'+row.sub+'」细分方向'),
              link([name,date,stage].filter(Boolean).join(' · '),dealHref));
            cases.append(block);
            break;
          }
        }
        if(!used.size)showGap(cases,row.sub?gaps['机构类似布局']:'缺少明确细分方向，无法按同一方向查找具名投资案例。');
        if(!matches.length)line(peers,'暂无可按同一细分方向列出的其他公司。');
        if(row.sub)line(peers,link('查看同方向公司 →','workspace.html?'+new URLSearchParams({view:'companies',sector:row.primary,sub:row.sub})));
      }catch{if(seq===version){line(peers,'同行资料暂时无法加载。');line(cases,'同方向机构案例暂时无法加载。');}}
    }catch{if(seq===version)status.textContent='公司档案暂时无法读取，请重新搜索。';}
  }
  const requiredFacts={
    '市场规模':['geography','period','marketScope','measurement'],
    '市场痛点':['buyer','scenario','problem'],
    '历史融资情况':['eventDate','round','amount'],
    '机构类似布局':['institution','portfolioCompany','eventDate','relevance'],
    '新增潜在机构':['institution','portfolioCompany','eventDate','relevance','checks'],
  };
  function sourceUrl(value){
    try{
      const url=new URL(value);
      return url.protocol==='https:' && !url.username && !url.password ? url.href : '';
    }catch{return '';}
  }
  function renderGenerated(panel,company,result){
    const cards=node('div','');cards.className='api-cards';
    const rows=result.sections||{};
    const history=new Set((rows['历史融资情况']||[]).flatMap(row=>row.investors||[]).map(institutionKey));
    for(const [key,title] of Object.entries(sections)){
      const article=node('article','');article.append(node('h3',title));
      let shown=0;
      for(const row of rows[key]||[]){
        const facts=(requiredFacts[key]||[]).map(field=>row[field]?.trim());
        if(facts.some(value=>!value)||!row.evidence?.trim())continue;
        if(key==='新增潜在机构' && history.has(institutionKey(row.institution)))continue;
        if(key==='历史融资情况' && !Array.isArray(row.investors))continue;
        const url=sourceUrl(row.source);
        if(!url)continue;
        const finding=node('div','');finding.className='generated-finding';
        if(key==='新增潜在机构'){
          line(finding,node('strong',[row.institution,row.portfolioCompany,row.eventDate].join(' · ')));
          line(finding,'入选依据 '+row.relevance);
          line(finding,'接洽前核实 '+row.checks);
        }else if(facts.length){
          line(finding,node('strong',facts.join(' · ')));
          if(key==='历史融资情况')line(finding,row.investors.length?'已披露参投 '+row.investors.join('、'):'参投方未披露');
        }
        line(finding,row.evidence);
        const source=node('small','');
        source.append(link([row.sourceKind||'原文',row.sourceDate].filter(Boolean).join(' · '),url));
        finding.append(source);
        if(row.judgment?.trim()){
          const judgment=node('p','');judgment.className='research-review';
          judgment.append(node('strong','分析判断'),' '+row.judgment);finding.append(judgment);
        }
        article.append(finding);shown++;
      }
      if(key==='历史融资情况')line(article,node('strong','老股东追加'),' '+(result.followOnGap||'需另核持股、跟投权及基金投资期限。'));
      const gap=result.sectionGaps?.[key];
      if(gap || !shown)showGap(article,gap||gaps[key]);
      cards.append(article);
    }
    const list=node('ol','');result.questions.forEach(q=>list.append(node('li',q)));
    panel.replaceChildren(node('h2',company),node('p',result.summary),cards,node('h3','问题清单'),list);
  }
  async function generateResearch(company,seq){
    const panel=byId('generated-study');
    const endpoint='https://guanshi-company-research.guanshi-pilot.workers.dev/research';
    const read=async response=>{
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'研究服务暂时不可用');
      return data;
    };
    status.textContent='6.2 Sol 正在检索公开资料并撰写八栏研究，通常需要几分钟。';
    const {job}=await read(await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company})}));
    for(let attempt=0;attempt<150;attempt++){
      await new Promise(resolve=>setTimeout(resolve,4000));
      if(seq!==version)return;
      const data=await read(await fetch(endpoint+'?job='+encodeURIComponent(job)));
      if(data.status!=='completed')continue;
      if(seq!==version)return;
      const result=data.result;
      if(result.clarification){status.textContent=result.clarification;return;}
      renderGenerated(panel,company,result);
      panel.hidden=false;status.textContent='研究已生成 · '+data.model;return;
    }
    throw Error('等待研究超时');
  }
  byId('company-finder').onsubmit=async e=>{
    e.preventDefault();const q=normalize(input.value);if(!q)return;
    const seq=++version;status.textContent='正在查找…';byId('choices').replaceChildren();byId('company-board').hidden=true;
    byId('generated-study').hidden=true;
    if(e.submitter?.value==='generate'){
      try{await generateResearch(input.value.trim(),seq);}catch(err){if(seq===version)status.textContent=err.message;}
      return;
    }
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
