/* The public archive IDs and opaque local project IDs travel between project views. */
const faNavigation = (() => {
  const publicId = /^[0-9a-f]{24}$/;
  const projectId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const params = new URLSearchParams(location.search);
  const current = params.get('project') || '';
  const from = params.get('from') === 'saved' ? 'saved' : 'matches';
  const candidate = params.get('candidate') || '';
  const archiveRoutes = new Set(['company.html','institution.html','deal.html','company-research.html']);
  const base = new URL('.', location.href);
  let registry, projectPromise;

  async function loadFunds() {
    registry ??= fetch('records/fa-funds.json').then(async response => {
      if (!response.ok) throw Error('基金管理关系暂时无法读取');
      return response.json();
    }).catch(error => { registry = undefined; throw error; });
    return registry;
  }

  function resolveInvestor(id, name, fundIndex) {
    if (!publicId.test(id)) throw new Error('机构 ID 无效');
    const fund = Object.hasOwn(fundIndex,id) ? fundIndex[id] : null;
    const funds = fund ? [{id, name:fund.name, href:'institution.html?id='+id, source:fund.source}] : [];
    if (fund && publicId.test(fund.managerId) && fund.managerId !== id && fund.managerName) {
      return {entityType:'institution', entityId:fund.managerId, name:fund.managerName, funds};
    }
    return {entityType:fund?'fund':'institution', entityId:id, name, funds};
  }

  function currentProject() {
    if (!projectId.test(current) || typeof faStore === 'undefined') return Promise.resolve(null);
    projectPromise ??= faStore.getProject(current).catch(()=>null);
    return projectPromise;
  }

  function contextHref(href, project, origin=from, selection=candidate) {
    const id = typeof project === 'string' ? project : project?.id;
    if (!projectId.test(id||'')) return href;
    const target = new URL(href, base);
    const name = target.pathname.slice(base.pathname.length);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname) || !archiveRoutes.has(name)) return href;
    target.searchParams.set('project', id);
    target.searchParams.set('from', origin === 'saved' ? 'saved' : 'matches');
    if (publicId.test(selection)) target.searchParams.set('candidate', selection);
    return target.href;
  }

  const projectUrl = (id, saved=false) => {
    const search = new URLSearchParams({project:id});
    if (saved) search.set('tab','saved');
    return 'projects.html?'+search;
  };
  const matchUrl = id => 'workspace.html?'+new URLSearchParams({project:id});

  function item(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function action(label, href, className) {
    const element = item('a',label,className);
    element.href=href;
    return element;
  }

  function projectBar(project) {
    const bar = item('div','','fa-context-bar');
    const destination = from === 'saved'
      ? projectUrl(project.id,true) + (publicId.test(candidate) ? '#candidate-'+candidate : '')
      : matchUrl(project.id);
    bar.append(action(from==='saved'?'返回项目清单':'返回项目候选',destination),
      item('span',project.title),action('项目记录',projectUrl(project.id)));
    return bar;
  }

  const visibleStages=new Set(['股权转让','介绍上市','拟增资']);

  async function evidenceFrom(rows, scope, fund) {
    const eligible = rows.filter(r=>!visibleStages.has(r[3]));
    const scoped = eligible.filter(r=>sectorFilter.matches(scope,r[5],r[6],r[8]));
    const shortlist = (scoped.length ? scoped : eligible).slice(0,3);
    const evidence = await Promise.all(shortlist.map(async r => {
      const id = new URL(r[0],base).searchParams.get('id');
      if (!publicId.test(id||'')) return null;
      const url = 'records/deal-'+id.slice(0,2)+'.json';
      const response = await fetch(url);
      if (!response.ok) throw Error('相关案例暂时无法读取，请重试');
      const deal = (await response.json())[id];
      if (!deal || deal.redirect) return null;
      return {id,title:deal.company,date:deal.day,dateKind:deal.dateKind||'',
        stage:deal.stage,sector:deal.sector,sub:deal.sub,
        companyId:new URL(deal.companyHref,base).searchParams.get('id'),href:deal.href,
        parties:deal.investors,sources:deal.sources,
        ...(fund ? {fundId:fund.id,fundName:fund.name} : {})};
    }));
    return {evidence:evidence.filter(Boolean),related:scoped.length};
  }

  function institutionSelection(project, id, row, publicScope) {
    const container = item('div','','fa-institution-pick');
    if (row.evidenceOnly) return container;
    const button = item('button','加入项目清单','fa-detail-primary');
    const status = item('span','','fa-detail-status');
    status.setAttribute('role','status');
    button.type='button';
    button.disabled=true;
    container.append(button,status);
    let identity, saved;
    function render() {
      const known = identity.funds.every(fund=>saved?.funds?.some(entry=>entry.id===fund.id));
      const remove = !!saved?.removedAt;
      button.textContent = remove?'恢复到项目清单':saved?(known?'已加入 · 查看清单':'关联本基金'):'加入项目清单';
      button.setAttribute('aria-pressed',String(!!saved&&!remove));
      button.disabled=false;
    }
    const prepare = async () => {
      try {
        identity=resolveInvestor(id,row.name,await loadFunds());
        const records=await faStore.listCandidates(project.id,{includeRemoved:true});
        saved=records.find(r=>r.entityId===identity.entityId&&r.entityType===identity.entityType);
        status.textContent='';
        render();
      } catch {
        identity=null;
        status.textContent='项目清单或基金关系读取失败。';
        button.textContent='重试读取';button.disabled=false;
      }
    };
    button.onclick=async()=>{
      if (!identity){button.disabled=true;await prepare();return;}
      const needsFunds = saved && identity.funds.some(f=>!saved.funds?.some(known=>known.id===f.id));
      if (saved && !saved.removedAt && !needsFunds){
        location.assign(projectUrl(project.id,true)+'#candidate-'+identity.entityId);return;
      }
      status.textContent='正在保存…';button.disabled=true;
      try{
        if (saved?.removedAt) saved=await faStore.restoreCandidate(project.id,identity.entityType,identity.entityId);
        if (saved && needsFunds){
          saved=await faStore.updateCandidate(project.id,identity.entityType,identity.entityId,
            {funds:[...saved.funds,...identity.funds.filter(f=>!saved.funds.some(known=>known.id===f.id))]},saved.revision);
        } else if (!saved){
          const scope = publicScope ?? sectorFilter.resolve(project.sector||'',project.sub||'');
          const {evidence,related} = await evidenceFrom(row.events,scope,identity.funds[0]);
          const reason = related && (scope.sector||scope.sub)
            ? '由机构档案加入。公开记录收录当前方向的投资案例。'
            : evidence.length ? '由机构档案加入，附最近披露案例。与本轮的适配程度仍待核实。'
            : '由机构档案加入；该档案的直接融资案例证据待补。';
          saved=await faStore.saveCandidate(project.id,{...identity,systemReason:reason,evidence,
            selection:{...scope,source:'机构档案'},concerns:'核对当前投资主体、阶段和项目冲突。',status:'待联系'});
        }
        status.textContent=saved?.removedAt?'该对象已移出，请选择恢复。':'已保存';
      }catch(error){
        status.textContent='保存失败。'+(error?.message||'请重试。');
      }finally{render();}
    };
    prepare();
    return container;
  }

  return {loadFunds,resolveInvestor,currentProject,contextHref,projectUrl,matchUrl,projectBar,institutionSelection};
})();
