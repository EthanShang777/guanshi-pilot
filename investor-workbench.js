(() => {
  const root=document.querySelector('#investor-workbench');
  if(!root)return;
  const el=(tag,text,cls)=>{
    const node=document.createElement(tag);
    if(text)node.textContent=text;
    if(cls)node.className=cls;
    return node;
  };
  const $=id=>root.querySelector('#'+id);
  const link=(label,href,cls)=>{
    const node=el('a',label,cls);node.href=href;return node;
  };
  const oid=/^[a-f\d-]{36}$/i;
  const chinaDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
  const when=value=>typeof value!=='string'||!value?'':value.includes('T')&&Number.isFinite(Date.parse(value))
    ? chinaDay.format(new Date(value)) : value.slice(0,10);
  const message=(host,text,href,label)=>{
    const p=el('p',text,'task-state');
    if(href)p.append(' ',link(label,href));
    host.replaceChildren(p);
  };
  const cache=new Map();
  async function load(name){
    if(!cache.has(name))cache.set(name,fetch('records/'+name+'.json').then(r=>{
      if(!r.ok)throw Error('无法读取公开索引');return r.json();
    }).catch(error=>{cache.delete(name);throw error;}));
    return cache.get(name);
  }
  const list=(host,rows)=>{
    const ul=el('ul','','workbench-list');
    for(const row of rows)ul.append(row);
    host.replaceChildren(ul);
  };
  function task(title,href,description,date){
    const row=el('li','','workbench-task');
    const name=el('strong');name.append(link(title,href));
    row.append(name);
    if(description)row.append(el('p',description));
    if(date)row.append(el('time',date));
    return row;
  }
  function sorted(rows){
    return rows.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,6);
  }
  function readWatches(rows){
    const host=$('workbench-watches');
    if(!rows.length){message(host,'尚未关注对象。可选择赛道，或在公司和机构详情点击关注。');return;}
    const readable=rows.flatMap(row=>{
      const focus=row.target;
      const item=focus&&investorActions.watchTarget(focus.type,focus.id,focus.name);
      if(!item)return [];
      const li=el('li','','watch-row');
      li.append(link(item.name,item.href),el('small',{company:'公司',institution:'机构与基金',sector:'赛道'}[item.type]));
      const manage=el('button','取消关注');manage.type='button';
      manage.setAttribute('aria-label','取消关注 '+item.name);
      manage.onclick=async()=>{
        manage.disabled=true;
        try{await faStore.removeResearch('watch',row.id,row.revision);$('workbench-watch-status').textContent='已取消关注 '+item.name;}
        catch(error){$('workbench-watch-status').textContent=error.message;manage.disabled=false;}
      };
      li.append(manage);return [li];
    });
    list(host,readable);
  }
  function renderContinue(projects,comparisons,judgments,candidates){
    const host=$('workbench-continue');
    const items=sorted([
      ...projects.filter(p=>oid.test(p.id)).map(p=>({title:p.title,href:'workspace.html?project='+p.id,summary:`融资项目 · ${p.companyName}`,date:p.activityAt||p.updatedAt,project:p.id})),
      ...comparisons.filter(p=>oid.test(p.id)).map(p=>({title:p.name||'公司比较',href:'compare.html?id='+p.id,summary:(p.companies||[]).map(company=>company.name).filter(Boolean).join('、'),date:p.updatedAt})),
      ...judgments.filter(p=>oid.test(p.id)).map(p=>({title:p.title||'研究判断',href:'judgments.html?judgment='+p.id,summary:'研究判断',date:p.updatedAt})),
    ]);
    if(!items.length){message(host,'保存比较、研究判断或融资项目后，可以在这里继续。','compare.html','比较公司');return;}
    const counts=new Map();
    for(const row of candidates)counts.set(row.projectId,(counts.get(row.projectId)||0)+1);
    list(host,items.map(p=>{
      const row=task(p.title,p.href,p.summary,when(p.date));
      if(counts.has(p.project))row.append(link('候选清单 · '+counts.get(p.project)+' 家','projects.html?project='+p.project+'&tab=saved','task-resume'));
      return row;
    }));
  }
  function renderNext(projects,candidates,judgments){
    const host=$('workbench-next'), byProject=new Map(projects.map(p=>[p.id,p]));
    const actions=sorted([
      ...candidates.filter(c=>byProject.has(c.projectId)&&c.nextAction&&!c.removedAt&&c.status!=='不适配'&&
        (c.nextActionUpdatedAt||c.feedbackUpdatedAt)).map(c=>({
        title:c.nextAction,href:'projects.html?'+new URLSearchParams({project:c.projectId,tab:'saved'})+'#candidate-'+c.entityId,
        summary:byProject.get(c.projectId).title+' · '+c.name+' · '+c.status,date:c.nextActionUpdatedAt||c.updatedAt,
      })),
      ...judgments.filter(j=>oid.test(j.id)&&j.nextAction).map(j=>({title:j.nextAction,href:'judgments.html?judgment='+j.id,summary:j.title||'研究判断',date:j.updatedAt})),
    ]);
    if(!actions.length){message(host,'暂无已记录的下一步。可以从研究判断或项目清单添加。','judgments.html','打开研究判断');return;}
    list(host,actions.map(a=>task(a.title,a.href,a.summary,when(a.date))));
  }
  function safeSource(url){
    try{const value=new URL(url);return /^https?:$/.test(value.protocol)&&!value.username&&!value.password ? value : null;}catch{return null;}
  }
  function changeRow(item,personal){
    const li=el('li','','workbench-change');
    const time=el('div','','change-date');
    const days=[['公告',item.disclosureDate],['事件',item.eventDate],['收录',item.firstSeenAt],['更正',item.correctedAt]];
    for(const [label,value] of days.filter(([,value])=>value).slice(0,3))time.append(el('span',`${label} ${when(value)}`));
    if(!time.childElementCount)time.append(el('span','日期未列明'));
    const main=el('div','','change-detail');
    const meta=el('span',item.label,'state-label');
    const title=el('strong');
    const id=/^deal\.html\?id=[a-f0-9]{24}$/.test(item.href||'')?item.href:'';
    const name=(item.title||'').split(' · ').filter(part=>part!==item.label).join(' · ');
    title.append(id?link(name,id):document.createTextNode(name));
    main.append(meta,title);
    if(personal&&item.reason)main.append(el('p',item.reason,'change-reason'));
    if(personal&&item.nextAction)main.append(el('small',item.nextAction));
    const source=item.sources?.map(s=>safeSource(s.url)).find(Boolean);
    if(source){const a=link('来源 · '+source.hostname,source.href,'source-link');a.target='_blank';a.rel='noopener noreferrer';main.append(a);}
    li.append(time,main);return li;
  }
  async function showChanges(context,version){
    const host=$('workbench-changes');
    const personal=Object.values(context).some(values=>values.length);
    const heading=$('workbench-change-title');
    heading.textContent=personal?'与我有关的变化':'公开概览';
    const items=await (personal?investorEvidence.loadRelated(context):investorEvidence.loadPublic());
    if(version!==renderVersion)return;
    const section=el('div','','workbench-feed');
    if(items.coverage?.scope){
      const dates=[['融资日更',items.coverage.ledgerThrough],['日扫回执',items.coverage.dotsThrough],
        ['历史批次',items.coverage.historicalBatchThrough]].filter(([,date])=>date).map(([label,date])=>label+' '+when(date));
      section.append(el('p',[items.coverage.scope,...dates].join(' · '),'workbench-coverage'));
    }
    if(items.status==='error')section.append(el('p','证据索引暂时无法读取。可重试或直接浏览公开融资档案。','task-state is-error'));
    else if(items.status==='unavailable')section.append(el('p','当前资料没有足够的时间或来源口径来判断变化。','task-state'));
    else if(!items.items?.length)section.append(el('p',personal?'在已检查的公开证据范围内，暂无与你当前关注相关的变化。':'在已检查的公开证据范围内，暂无可展示的变动。','task-state'));
    else {
      const rows=el('ul','','workbench-list');
      const displayed=personal?items.items.slice(0,7):
        [...items.items.filter(item=>item.kind!=='historical').slice(0,4),...items.items.filter(item=>item.kind==='historical').slice(0,2)];
      rows.append(...displayed.map(item=>changeRow(item,personal)));section.append(rows);
    }
    if(!personal){
      const meta=await load('manifest').catch(()=>null);
      if(version!==renderVersion)return;
      const overview=el('div','','workbench-public');
      if(meta)overview.append(el('p',`${meta.companies.toLocaleString('zh-CN')} 家公司 · ${meta.events.toLocaleString('zh-CN')} 笔融资档案 · ${meta.institutions.toLocaleString('zh-CN')} 家机构与基金`,'tabular'));
      overview.append(link('浏览融资时间线','discover.html'),link('选择关注方向','#workbench-watch'),link('查找公司','companies.html'));
      overview.querySelector('a[href^="#"]').dataset.openWorkbench='workbench-watch';
      section.prepend(overview);
    }
    host.replaceChildren(section);
  }
  let renderVersion=0;
  async function render(){
    const version=++renderVersion;
    try{
      const [watches,comparisons,judgments,projects]=await Promise.all([
        faStore.listResearch('watch'),faStore.listResearch('comparison'),faStore.listResearch('judgment'),faStore.listProjects(),
      ]);
      const candidates=(await Promise.all(projects.map(p=>faStore.listCandidates(p.id)))).flat();
      if(version!==renderVersion)return;
      readWatches(watches);renderContinue(projects,comparisons,judgments,candidates);renderNext(projects,candidates,judgments);
      await showChanges({watches,projects,candidates,judgments,comparisons},version).catch(()=>{
        if(version===renderVersion)message($('workbench-changes'),'证据索引暂时无法读取。','changes.html','查看证据追踪');
      });
    }catch{
      if(version!==renderVersion)return;
      for(const id of ['workbench-changes','workbench-continue','workbench-next','workbench-watches']) {
        message($(id),'浏览器记录暂时无法读取。刷新可重试。');
      }
    }
  }
  root.addEventListener('click',event=>{
    const trigger=event.target.closest('[data-open-workbench]');
    if(trigger)$(trigger.dataset.openWorkbench).open=true;
  });
  if(location.hash==='#workbench-watch')$('workbench-watch').open=true;
  const watchForm=$('workbench-watch-form');
  let sectors=[];
  load('investor-sectors').then(items=>{
    sectors=items;watchForm.elements.sector.append(...items.map(s=>new Option(s.name,s.id)));
  }).catch(()=>{$('workbench-watch-status').textContent='暂时无法读取赛道目录。';});
  watchForm.onsubmit=async event=>{
    event.preventDefault();
    const sector=sectors.find(s=>s.id===watchForm.elements.sector.value);
    if(!sector)return;
    const status=$('workbench-watch-status'), id='sector:'+sector.id;
    try{
      if(await faStore.getResearch('watch',id)){status.textContent='已关注 '+sector.name;return;}
      await faStore.saveResearch('watch',{id,target:investorActions.watchTarget('sector',sector.id,sector.name)});
      status.textContent='已关注 '+sector.name;
    }catch(error){status.textContent=error.message;}
  };
  const backupStatus=$('workbench-backup-status');
  $('workbench-export').onclick=async()=>{
    try{
      const backup=await faStore.exportBackup();
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
      const address=URL.createObjectURL(blob);
      const a=link('下载备份',address);a.download='观势浏览器备份-'+when(backup.exportedAt)+'.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(address),500);
      backupStatus.textContent='已生成包含私有工作记录的本机备份。';
    }catch(error){backupStatus.textContent=error.message;}
  };
  $('workbench-import').onchange=async event=>{
    const input=event.target,file=input.files[0];
    if(!file)return;
    try{
      const counts=await faStore.importBackup(await file.text());
      backupStatus.textContent=`已恢复 ${counts.research} 条关注或研究记录、${counts.projects} 个项目。${counts.conflicts ? '保留 '+counts.conflicts+' 条冲突的本机记录。' : ''}`;
    }catch(error){backupStatus.textContent=error.message;}
    finally{input.value='';}
  };
  faStore.subscribe(()=>render());
  render();
})();
