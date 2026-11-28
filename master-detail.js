(async()=>{
  const root=document.querySelector('#record'), kind=root.dataset.kind;
  const id=new URLSearchParams(location.search).get('id');
  const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  let activeProject;
  const link=(url,text)=>{const a=el('a',text);a.href=activeProject?faNavigation.contextHref(url,activeProject):url;return a;};
  const yuan=fen=>(fen/100).toLocaleString('zh-CN',{maximumFractionDigits:2})+' 元';
  function context(url,sector,sub){
    const target=new URL(url,location.href);
    if(sector)target.searchParams.set('sector',sector);
    if(sub)target.searchParams.set('sub',sub);
    return activeProject?faNavigation.contextHref(target.href,activeProject):target.href;
  }
  const nonFinancing = new Set(['股权转让','拟增资','介绍上市']);
  function companyLead(row,id){
    const lead=el('section','');
    lead.className='fa-company-lead';
    const identity=el('div',''), money=el('div','');
    const sourceClaims=row.profile?.claims?.filter(claim=>claim.sources?.length)||[];
    const business=sourceClaims.find(claim=>/官方.*(?:产品|企业页)|支持.*部署|提供.*工具|主营|产品为/u.test(claim.text));
    const analysis=sourceClaims.find(claim=>claim!==business);
    const limits=[...new Set(sourceClaims.flatMap(claim=>claim.limits||[]))];
    if(row.registeredName && row.registeredName!==row.name){
      const registered=el('p',row.registeredName);registered.className='fa-company-identity';
      identity.append(registered);
    }
    if(!row.registeredName && !/(?:公司|合伙企业|研究院|研究所|工厂|大学|合作社)$/u.test(row.name)){
      const legal=el('p','法定名称待核');legal.className='fa-company-meta';identity.append(legal);
    }
    if(row.aliases?.length){
      const aliases=el('p','已核名称 '+row.aliases.join('、'));aliases.className='fa-company-meta';identity.append(aliases);
    }
    const heading=[row.location,row.primaryId==='unknown'?'赛道待归类':row.primary,row.sub].filter(Boolean).join(' · ');
    if(heading){const meta=el('p',heading);meta.className='fa-company-meta';identity.append(meta);}
    const summaryLine=business?.text.match(/^[^。！？]+[。！？]?/u)?.[0];
    const intro=el('p',summaryLine||(
      row.sub?'融资档案中的业务方向为「'+row.sub+'」。':'公开档案暂无可引用的具体主营说明。'));
    intro.className='fa-company-business';
    identity.append(intro);
    if(business){
      const evidence=el('p','');
      business.sources.slice(0,2).forEach(source=>evidence.append(link(source.url,source.title+' ↗'),' '));
      identity.append(evidence);
    }
    const actions=el('div','');actions.className='fa-company-actions';
    const chooser='projects.html?'+new URLSearchParams({company:id});
    const initial='为本轮找投资方';
    const primary=link(chooser,initial);primary.className='fa-detail-primary';
    actions.append(primary);
    const create=link(chooser+'&new=1','新建融资项目');
    const adjacentParams=new URLSearchParams({view:'institutions',client:id});
    if(row.primaryId!=='unknown')adjacentParams.set('sector',row.primary);
    if(row.sub && row.primaryId!=='unknown' && row.hasFineDirection!==false)adjacentParams.set('adjacent',row.sub);
    const adjacentUrl='workspace.html?'+adjacentParams;
    const adjacentLink=link(adjacentUrl,'找相邻方向投资方');
    create.hidden=true;
    actions.append(create);
    identity.append(actions);
    if(typeof faStore!=='undefined'){
      async function refreshAction(){
        try{
          const own=(await faStore.listProjects()).filter(project=>project.companyId===id);
          const selected=activeProject?.companyId===id?own.find(project=>project.id===activeProject.id):null;
          const direct=selected||(own.length===1?own[0]:null);
          adjacentLink.href=direct?faNavigation.matchUrl(direct.id)+'&scope=adjacent':adjacentUrl;
          if(direct){
            primary.href=faNavigation.matchUrl(direct.id);
            primary.textContent='继续项目';
          }else{
            primary.href=chooser;
            primary.textContent=own.length?'选择融资项目':initial;
          }
          create.hidden=own.length===0;
        }catch{
          primary.href=chooser;
          primary.textContent=initial;
        }
      }
      refreshAction();
      window.addEventListener('pageshow',event=>{if(event.persisted)refreshAction();});
    }
    const usefulLinks=el('nav','');usefulLinks.className='fa-company-links';usefulLinks.setAttribute('aria-label','公司资料');
    if(row.events.some(event=>!nonFinancing.has(event[2])))usefulLinks.append(link('company-research.html?id='+id,'公司研究台'));
    usefulLinks.append(adjacentLink);
    if(row.sub)usefulLinks.append(link(context('workspace.html?view=companies',row.primary,row.sub),'对照同行'));
    identity.append(usefulLinks);

    const financing=row.events.filter(event=>!nonFinancing.has(event[2]));
    money.className='fa-company-financing';
    money.append(el('h2','最近融资'));
    if(financing.length){
      const [href,day,stage,amount]=financing[0];
      const terms=el('p','');terms.append(link(href,[day,stage,amount].filter(Boolean).join(' · ')||'查看交易披露'));
      money.append(terms);
    }else money.append(el('p','档案暂无已收录融资。'));
    const counterparties=new Map();
    financing.forEach(event=>event[4].forEach(([label,href])=>{
      if(!counterparties.has(href))counterparties.set(href,label);
    }));
    if(counterparties.size){
      const all=[...counterparties];
      const backers=el('p','历史披露资方　');backers.className='fa-history-backers';
      function addNames(target,names){
        names.forEach(([href,label],i)=>target.append(i?'、':'',link(href,label)));
      }
      addNames(backers,all.slice(0,3));money.append(backers);
      if(all.length>3){
        const more=el('details',''), rest=el('p','');
        more.append(el('summary','其他披露资方 · '+(all.length-3)+' 家'),rest);
        addNames(rest,all.slice(3));money.append(more);
      }
    }else money.append(el('p','历史披露资方待补充。'));
    const gap=el('p', limits[0]||'商业化进展待补充具名客户、付费或验收证据。');gap.className='fa-company-gap';money.append(gap);
    if(analysis||row.profile?.question||limits.length>1||business?.text!==summaryLine){
      const item=el('details','');item.className='fa-company-evidence';
      item.append(el('summary','研究判断与待核问题'));
      if(analysis){
        item.append(el('small',row.profile.asof||'档案研究'),el('p',analysis.text));
        analysis.sources.slice(0,2).forEach(source=>item.append(link(source.url,source.title+' ↗'),' '));
      }
      if(business && business.text!==summaryLine)item.append(el('p',business.text));
      if(row.profile?.question)item.append(el('p',row.profile.question));
      for(const limit of limits.slice(1))item.append(el('p',limit));
      money.append(item);
    }
    lead.append(identity,money);
    return lead;
  }
  if(!id && root.dataset.default){location.replace(root.dataset.default);return;}
  try{
    if(!/^[a-f0-9]{24}$/.test(id||''))throw Error();
    const res=await fetch('records/'+kind+'-'+id.slice(0,2)+'.json');
    if(!res.ok)throw Error();
    const row=(await res.json())[id];if(!row)throw Error();
    if(row.redirect){
      if(!/^[a-f0-9]{24}$/.test(row.redirect)||row.redirect===id)throw Error();
      const destination=new URL(location.href);
      destination.searchParams.set('id',row.redirect);
      location.replace(destination.href);
      return;
    }
    if(typeof faNavigation!=='undefined'){
      activeProject=await faNavigation.currentProject();
      if(activeProject)root.append(faNavigation.projectBar(activeProject));
    }
    const name=row.company||row.name;
    document.querySelector('h1').textContent=name;document.title=name+' · 观势';
    if(kind==='deal'){
      const summary=el('section','');summary.className='deal-summary';
      const summaryItems=row.stage==='股权转让'
        ? [['转让对价',row.amount],['交易类型',row.stage]]
        : [['披露金额',row.amount],['融资轮次',row.stage],['估值',row.valuation]];
      for(const [label,value] of summaryItems){
        
        const cell=el('div','');cell.append(el('small',label),el('strong',value||'未列明'));summary.append(cell);
      }
      root.append(summary,el('p',[row.dateKind,row.day||'日期未列明',row.location,row.sector,row.sub].filter(Boolean).join(' · ')),link(row.companyHref,'公司档案 →'));
      for(const url of row.sources){const p=el('p','');p.append(link(url,'来源 · '+new URL(url).hostname));root.append(p);}
      const parties=el('section','');parties.className='counterparties';parties.append(el('h2',row.stage==='股权转让'?'受让方':'参与机构'));
      const allocations = new Map((row.partyAllocations || []).map(p=>[p.institutionId,p]));
      const observations=row.participation||[];
      for(const [n,url] of row.parties){
        const target=context(url,row.sector,row.sub);
        const id=new URL(target).searchParams.get('id'), detail=allocations.get(id);
        const roles=[...new Set(observations.filter(item=>item.name===n).flatMap(item=>item.roles))];
        const line=el('p','');
        line.append(link(target,[n,...roles,detail&&(detail.basis+' '+yuan(detail.amountFen))].filter(Boolean).join(' · ')+' →'));
        if(detail?.source)line.append(' ',link(detail.source,'出资来源 ↗'));
        if(row.allocationConflicts?.includes(id))line.append(' · 出资披露口径待核');
        parties.append(line);
      }
      if(!row.parties.length)parties.append(el('p','未列明具名参与方'));
      root.append(parties);
      if(observations.length || row.sectorEvidence){
        const evidence=el('details','');evidence.append(el('summary','原始分类与交易参与披露'));
        const taxonomy=row.sectorEvidence;
        if(taxonomy) {
          const labels=[...new Set([taxonomy.primary,taxonomy.secondary,taxonomy.label].filter(Boolean))];
          const field=el('p','来源分类 · '+(labels.join(' / ')||'未列明'));
          if(/^https?:[/][/]/.test(taxonomy.source||''))field.append(' · ',link(taxonomy.source,'分类依据 ↗'));
          else if(taxonomy.source)field.append(' · '+taxonomy.source);
          evidence.append(field);
        }
        for(const item of observations){
          const line=el('p',[item.rawName,...item.roles,item.name?null:item.status,item.amount].filter(Boolean).join(' · '));
          const value=item.contribution;
          if(value && Number.isSafeInteger(value.amountFen)){
            line.append(' · 原始出资披露 '+[value.basis,yuan(value.amountFen)].filter(Boolean).join(' '));
            if(row.sources.includes(value.source))line.append(' ',link(value.source,'披露来源 ↗'));
          }
          evidence.append(line);
        }
        root.append(evidence);
      }
      for(const rid of row.reports)root.append(link('report-'+rid+'.html','相关研究 →'));

    }else if(kind==='company'){
      root.append(companyLead(row,id),el('h2','交易记录 · '+row.events.length+' 笔'));
      const find=document.getElementById('local-find');
      if(find){
        const tools=el('details','');tools.className='fa-page-find';
        tools.append(el('summary','页内查找'),find);root.append(tools);
      }
      root.append(companyHistory.timeline(row,context));
    }else{
      const params=new URLSearchParams(location.search),sub=params.get('sub'),sector=params.get('sector');
      const related=row.events.filter(r=>sub?r[6]===sub && (!sector||r[5]===sector):sector && r[5]===sector);
      if(sub||sector){
        const companies=new Map();
        for(const r of related){
          if(!companies.has(r[7]))companies.set(r[7],[]);
          companies.get(r[7]).push(r);
        }
        root.append(el('h2',(sub||sector)+' · '+companies.size+' 家公司 · '+related.length+' 笔'));
        for(const events of companies.values()){
          const section=el('section','');section.append(link(events[0][7],events[0][1]));
          for(const [url,,day,stage,amount] of events){
            const p=el('p','');p.append(link(url,[day,stage,amount].filter(Boolean).join(' · ')));section.append(p);
          }
          root.append(section);
        }
      }
      const fund=row.fundDisclosures?.find(item=>item.fundId===id);
      const coverage=row.fundCoverage;
      if(fund && coverage){
        const section=el('section','');
        section.className='profile-records';
        section.append(el('h2','基金规模与出资'));
        const basis=el('p',fund.capitalBasis+' '+yuan(fund.sizeCny*100)+' · '+fund.source.date);
        basis.append(el('span','　'),link(fund.source.url,'来源 ↗'));
        section.append(basis,el('p','已收录 '+coverage.totalEvents+' 笔投资，'+coverage.disclosedEvents+' 笔有本基金出资金额'));
        for(const [label,total] of Object.entries(coverage.totalsFen)){
          if(total) section.append(el('p','已核实'+label+' '+yuan(total)));
        }
        for(const stat of fund.publishedStatistics){
          const metrics=[];
          if(Number.isFinite(stat.fundedCny)) metrics.push('已募集 '+yuan(stat.fundedCny*100));
          if(Number.isFinite(stat.investedCny)) metrics.push('已投放 '+yuan(stat.investedCny*100));
          if(Number.isInteger(stat.investments)) metrics.push('已投 '+stat.investments+' 个项目');
          if(!metrics.length) continue;
          const p=el('p','截至 '+stat.asOf+'，'+metrics.join('，'));
          p.append(el('span','　'),link(stat.source,'历史披露 ↗'));
          section.append(p);
        }
        const balance = fund.reportedBalance;
        const available = el('p',balance
          ? '披露可投额度 '+yuan(balance.amountCny*100)+' · '+balance.asOf
          : '剩余可投额度 · 待披露');
        if(balance) available.append(el('span','　'),link(balance.source,'来源 ↗'));
        section.append(available);
        if(coverage.cases.length){
          const cases=el('details','');
          cases.append(el('summary','查看已核实出资'));
          for(const c of coverage.cases){
            const p=el('p','');
            p.append(link(c.href,c.company+' · '+c.day),el('span','　'+c.basis+' '+yuan(c.amountFen)+'　'),link(c.source,'来源 ↗'));
            cases.append(p);
          }
          section.append(cases);
        }
        root.append(section);
      }
      if(row.lpFundRelations?.length){
        const section=el('section','');
        section.className='profile-records';
        const details=el('details','');
        details.append(el('summary','作为 LP 出资的基金'));
        for(const f of row.lpFundRelations){
          const p=el('p','');
          p.append(link('institution.html?id='+f.fundId,f.fundName+' →'),
                   el('span','　'+[Number.isFinite(f.disclosedPercent)?f.disclosedPercent+'%':'',f.source.date].filter(Boolean).join(' · ')));
          details.append(p);
        }
        section.append(details);
        root.append(section);
      }
      if(row.fundDisclosures?.length){
        const funds=el('section','');
        funds.className='profile-records';
        funds.append(el('h2',row.fundDisclosures.some(fund=>fund.fundId===id)?'有限合伙人（LP）':'旗下基金的有限合伙人（LP）'));
        for(const fund of row.fundDisclosures){
          const details=el('details','');
          const count=fund.partners.length+(fund.otherLpCount ?? 0);
          const countLabel=(fund.otherLpCount===null?'已披露 ':'')+count+' 位 LP';
          const heading=fund.fundId===id?'查看公开披露':fund.fundName;
          details.append(el('summary',heading+' · '+countLabel));
          if(fund.fundId!==id){
            details.append(link('institution.html?id='+fund.fundId,'基金档案 →'));
          }
          if(fund.fundId===id && fund.managerId!==id){
            details.append(link('institution.html?id='+fund.managerId,'管理人 · '+fund.managerName+' →'));
          }
          const list=el('ul','');
          for(const partner of fund.partners){
            const item=el('li','');
            item.append(partner.existingInstitution
              ? link('institution.html?id='+partner.existingInstitution,partner.name)
              : el('span',partner.name));
            const amounts=[];
            if(Number.isFinite(partner.disclosedContributionCny)){
              const amount=(partner.disclosedContributionCny/10000).toLocaleString('zh-CN',{maximumFractionDigits:4});
              amounts.push(fund.capitalBasis+' '+amount+' 万元');
            }
            if(Number.isFinite(partner.disclosedPercent))amounts.push(partner.disclosedPercent+'%');
            if(amounts.length)item.append(el('small',' · '+amounts.join(' · ')));
            list.append(item);
          }
          details.append(list);
          if(fund.otherLpCount)details.append(el('p','另有 '+fund.otherLpCount+' 位个人 LP，见原始披露。'));
          if(fund.otherLpCount===null && fund.source.lpScope)details.append(el('p',fund.source.lpScope));
          const citation=el('p','');
          citation.append(link(fund.source.url,fund.source.issuer+' ↗'),el('small',' · '+fund.source.dateKind+' '+fund.source.date));
          details.append(citation);
          funds.append(details);
        }
        root.append(funds);
      }
      root.append(el('h2','全部投资记录 · '+row.events.length+' 笔'));
      for(const [url,company,day,stage,amount] of row.events){
        const a=link(url,[day||'日期未列明',company,stage,amount].filter(Boolean).join(' · '));a.className='directory-row';a.replaceChildren(el('span',company),el('small',day||'日期未列明'),el('span',stage||'轮次未记录'),el('span','披露金额　'+(amount||'未记录')));root.append(a);
      }
    }
  }catch{root.append(el('p','档案加载失败，请刷新重试。'),link('search.html','返回融资检索'));}
})();
