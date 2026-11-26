(async()=>{
  const root=document.querySelector('#record'), kind=root.dataset.kind;
  const id=new URLSearchParams(location.search).get('id');
  const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const link=(url,text)=>{const a=el('a',text);a.href=url;return a;};
  const yuan=fen=>(fen/100).toLocaleString('zh-CN',{maximumFractionDigits:2})+' 元';
  function context(url,sector,sub){
    const target=new URL(url,location.href);
    if(sector)target.searchParams.set('sector',sector);
    if(sub)target.searchParams.set('sub',sub);
    return target.href;
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
      for(const [n,url] of row.parties){
        const target=context(url,row.sector,row.sub);
        const detail=allocations.get(new URL(target).searchParams.get('id'));
        parties.append(link(target,[n,detail && (detail.basis+' '+yuan(detail.amountFen))].filter(Boolean).join(' · ')+' →'));
      }
      if(!row.parties.length)parties.append(el('p','未列明'));root.append(parties);
      for(const rid of row.reports)root.append(link('report-'+rid+'.html','相关研究 →'));

    }else if(kind==='company'){
      if(row.events.some(event=>event[2]!=='股权转让')){
        root.append(link('company-research.html?id='+id,'打开公司研究台 →'),el('span','　'));
      }
      if(row.primary){
        const adjacent=new URLSearchParams({view:'institutions',sector:row.primary,client:id});
        if(row.sub)adjacent.set('adjacent',row.sub);
        root.append(link('workspace.html?'+adjacent,'找相邻方向投资方 →'),el('span','　'));
      }
      if(row.sub){
        root.append(link(context('workspace.html?view=companies',row.primary,row.sub),'对照同行 · '+row.sub+' →'));
      }
      if(row.profile){
        const claim=row.profile.claims.find(c=>c.sources.length);
        if(claim){
          root.append(el('h2','公司研究 · '+row.profile.asof),el('p',claim.text));
          for(const source of claim.sources)root.append(link(source.url,source.title+' ↗ '));
          if(row.profile.question)root.append(el('p',row.profile.question));
        }
      }
      root.append(el('p',[row.location,row.sector].filter(Boolean).join(' · ')),el('h2','交易记录 · '+row.events.length+' 笔'),companyHistory.timeline(row,context));
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
