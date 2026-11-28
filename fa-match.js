/* Project matching uses public financing evidence and keeps work in the browser. */
const faMatching = (() => {
  const recordId = /^[a-f0-9]{24}$/;
  const clientStageExcluded = new Set(['股权转让', '介绍上市', '拟增资']);
  const cohorts = {new:'新增机构', follow:'历史资方追加', all:'全部'};
  const nameKey = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const stageKey = value => nameKey(value).replace(/series|[\s—-]|轮|融资/g, '');
  const family = value => stageKey(value).replace(/^pre/, '').replace(/[+0-9]+$/, '');
  const isRecordedStage = value => /^(?:pre)?[a-h](?:[+0-9]+)?$|^(?:种子|天使[+]?|preipo|ipo|战略)$/.test(stageKey(value));
  const recordUrl = (type, id) => type + '.html?id=' + encodeURIComponent(id);

  function roundMatch(value, goal, mode) {
    const stage = stageKey(value), target = stageKey(goal);
    if (!target || !stage) return false;
    if (mode === 'family') return family(stage) === family(target);
    if (mode === 'keyword') return stage.includes(target);
    return stage === target;
  }

  function parseQuery(question, meta, current) {
    const filters = {...current};
    const found = [];
    const remaining = question.normalize('NFKC');
    const options = Object.entries(meta.subs).flatMap(([sector, directions]) => directions.map(sub => ({sector, sub})));
    let unresolved = remaining;
    const recognize = (text, key, value) => {
      filters[key] = value;
      found.push(key==='cohort'?cohorts[value]:value);
      unresolved = unresolved.replace(text, ' ');
    };
    const statedSector = meta.sectors.filter(s => remaining.includes(s)).sort((a,b) => b.length-a.length)[0];
    const directionText=statedSector?remaining.replace(statedSector,' '):remaining;
    const direction = options.filter(t => directionText.includes(t.sub) && (!statedSector||t.sector===statedSector))
      .sort((a,b) => b.sub.length - a.sub.length)[0];
    if (direction) {
      filters.sector = direction.sector;
      recognize(direction.sub, 'sub', direction.sub);
      if (direction.sector === statedSector) unresolved = unresolved.replace(statedSector,' ');
    } else if (statedSector) {
      recognize(statedSector, 'sector', statedSector);
      filters.sub = '';
    }
    const year = remaining.match(/20\d\d(?:年)?/)?.[0] || (remaining.includes('今年') ? '今年' : '');
    const number = year === '今年' ? String(new Date().getFullYear()) : year.slice(0,4);
    if (meta.years.includes(number)) recognize(year, 'year', number);
    const round = remaining.match(/(?:pre[ -]?)?[a-h](?:\+{1,3}|\d)?\s*轮|种子轮|天使轮|战略融资/i)?.[0];
    if (round) {
      recognize(round, 'stage', round.trim());
      filters.mode = 'exact';
    }
    const role = remaining.match(/历史资方追加|老股东追加|新增机构|新增资方|全部机构/)?.[0];
    if (role) recognize(role, 'cohort', /追加/.test(role) ? 'follow' : role === '全部机构' ? 'all' : 'new');
    unresolved = unresolved.replace(/查找|搜索|筛选|找|投过|相关|机构|投资方|资方|公司|赛道|方向|的/g,'')
      .replace(/^[\s,，、;；。]+|[\s,，、;；。]+$/g,'').replace(/\s+/g,' ');
    return {filters, found, unresolved};
  }

  function analyze({rows, historyRows, filters, project, fundIndex={}, aliases={}, sectorFilter}) {
    const scope = {sector:filters.sector || '', sub:filters.sub || ''};
    const adjacent = filters.adjacent && !scope.sub && scope.sector && scope.sector === project.sector && project.sub;
    const words = String(filters.keyword || '').split(/[,，、\s]+/).map(nameKey).filter(Boolean);
    const investor = nameKey(filters.investor);
    const fundByName = new Map(Object.entries(fundIndex).map(([id, fund]) => [fund.name, {...fund,id}]));
    function identity(name) {
      const fund = fundByName.get(name);
      if (!fund) return {name, id:'', type:'institution'};
      if (recordId.test(fund.managerId) && fund.managerId !== fund.id && fund.managerName) {
        return {name:fund.managerName, id:fund.managerId, type:'institution', fund};
      }
      return {name:fund.name, id:fund.id, type:'fund', fund};
    }
    const localDealIds = new Set(historyRows.map(row => row[0]));
    const historicalNames = new Set(historyRows.flatMap(row => row[7].map(n => identity(n).name)));
    const groups = new Map();
    const queryMatch = (party, entity) => !investor || [party,entity.name,...(aliases[party] || []),...(aliases[entity.name] || [])]
      .some(n => nameKey(n).includes(investor));
    let scopedCases = 0;

    function consider(row, own) {
      const withinYear = !filters.year || String(row[3]).startsWith(filters.year);
      const wordsMatch = words.length && words.some(word =>
        [row[1],...row[2],row[4],row[9]].some(value => nameKey(value).includes(word)));
      const withinScope = sectorFilter.matches(scope, row[4], row[9] || '', row[12]) &&
        (!adjacent || Boolean(row[9] && row[9]!==project.sub));
      const directionUnknown = !adjacent && !!scope.sub && !row[9] && sectorFilter.matches({sector:scope.sector}, row[4], '', row[12]);
      const relevant = (scope.sector || scope.sub ? (withinScope || directionUnknown) : Boolean(wordsMatch || investor));
      const comparable = !own && withinYear && relevant;
      if (!own && !comparable) return;
      if (comparable) scopedCases++;

      for (const name of row[7]) {
        const entity = identity(name);
        const historical = historicalNames.has(entity.name);
        if ((filters.cohort === 'follow' && !historical) || (filters.cohort !== 'follow' && filters.cohort !== 'all' && historical)) continue;
        if (!queryMatch(name,entity)) continue;
        if (!groups.has(entity.name)) groups.set(entity.name, {
          name:entity.name, id:entity.id, type:entity.type, historical, cases:new Map(), knownFunds:new Map(),
        });
        const group = groups.get(entity.name);
        if (entity.id) group.id = entity.id;
        if (entity.fund) group.knownFunds.set(entity.fund.id, entity.fund);
        if (!group.cases.has(row[0])) group.cases.set(row[0], {
          row, own, withinScope, directionUnknown, wordsMatch:Boolean(wordsMatch), funds:new Map(),
        });
        if (entity.fund) group.cases.get(row[0]).funds.set(entity.fund.id,entity.fund);
      }
    }

    for (const row of historyRows) consider(row,true);
    for (const row of rows) {
      if (!localDealIds.has(row[0])) consider(row,false);
    }

    let unknownExcluded = 0;
    let unknownKept = 0;
    const ranks = {fit:2, different:1, unknown:0};
    const processed = [];
    for (const group of groups.values()) {
      const cases = [...group.cases.values()];
      const peers = cases.filter(entry => !entry.own);
      const scopeEvidence = peers.length ? peers : cases;
      const stageEvidence = filters.year ? cases.filter(({row})=>String(row[3]).startsWith(filters.year)) : cases;
      const relevantCases = [...cases].sort((a,b) =>
        Number(b.withinScope)-Number(a.withinScope) ||
        Number(roundMatch(b.row[5],filters.stage,filters.mode))-Number(roundMatch(a.row[5],filters.stage,filters.mode)) ||
        Number(b.wordsMatch)-Number(a.wordsMatch) ||
        String(b.row[3]).localeCompare(String(a.row[3])) || a.row[0].localeCompare(b.row[0]));
      const recent = [...scopeEvidence].sort((a,b)=>String(b.row[3]).localeCompare(String(a.row[3])))[0];
      const checks = [];
      if (scope.sector || scope.sub) {
        const hasEvidence = scopeEvidence.some(entry => entry.withinScope);
        const hasKnown = scopeEvidence.some(({row}) => scope.sub ? row[9] : row[4] && row[4] !== '待归类');
        checks.push({label:scope.sub||adjacent?'细分方向':'赛道',state:hasEvidence?'fit':hasKnown?'different':'unknown',
          text:hasEvidence?(adjacent?'同赛道其他已知细分':scope.sub||scope.sector):(hasKnown?'已收录案例与所选方向不同':'案例细分证据不足')});
      }
      if (filters.stage) {
        const isFit = stageEvidence.some(({row}) => roundMatch(row[5],filters.stage,filters.mode));
        const explicit = stageEvidence.some(({row}) => isRecordedStage(row[5]));
        checks.push({label:'历史轮次',state:isFit?'fit':explicit?'different':'unknown',
          text:isFit?'有'+filters.stage+'可比案例':explicit?'已知案例轮次不同':'缺可比轮次证据'});
      }
      if (words.length) {
        const isFit = scopeEvidence.some(entry => entry.wordsMatch);
        checks.push({label:'业务关键词',state:isFit?'fit':'unknown',text:isFit?'案例名称或分类命中':'需核案例业务'});
      }
      if (project.ticket) checks.push({label:'单家票面',state:'unknown',text:'待核当前单家票面'});
      if (project.region) checks.push({label:'地域与落地',state:'unknown',text:'待核当前落地要求'});
      const unknown = !checks.length || checks.some(check => check.state === 'unknown');
      if (unknown && filters.excludeUnknown) {
        unknownExcluded++;
        continue;
      }
      if (unknown) unknownKept++;
      const directionRank = ranks[checks.find(c=>c.label==='细分方向'||c.label==='赛道')?.state] || 0;
      const roundRank = ranks[checks.find(c=>c.label==='历史轮次')?.state] || 0;
      const keywordRank = ranks[checks.find(c=>c.label==='业务关键词')?.state] || 0;
      const companyCount = new Set(peers.map(({row})=>row[11])).size;
      processed.push({
        name:group.name,id:group.id,type:group.type,historical:group.historical,checks,unknown,
        caseCount:cases.length, companyCount, peerCount:peers.length, relevantCases, recent,
        funds:[...group.knownFunds.values()], directionRank, roundRank, keywordRank,
      });
    }
    const byDate = (a,b)=>String(b.recent?.row[3]||'').localeCompare(String(a.recent?.row[3]||''));
    const byEvidence = (a,b)=>b.directionRank-a.directionRank || b.roundRank-a.roundRank || b.keywordRank-a.keywordRank;
    const byCount = (a,b)=>b.companyCount-a.companyCount || b.caseCount-a.caseCount;
    const collator = new Intl.Collator('zh-CN');
    processed.sort((a,b)=>{
      const first=filters.sort==='recent'?byDate(a,b):filters.sort==='cases'?byCount(a,b):byEvidence(a,b);
      return first || byEvidence(a,b) || byDate(a,b) || byCount(a,b) || collator.compare(a.name,b.name);
    });
    return {groups:processed, scopedCases, unknownExcluded, unknownKept, historicalCount:historicalNames.size};
  }

  function node(tag, text='', className='') {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  function button(text, click, cls='') {
    const el = node('button',text,cls);
    el.type = 'button';
    el.onclick = click;
    return el;
  }

  const casesUrl = id => recordUrl('deal',id);
  const caseTitle = row => [row[1],row[3],row[5]].filter(Boolean).join(' · ');
  const caseCompany = href => /^company\.html\?id=([a-f0-9]{24})$/.exec(href)?.[1] || '';
  const conditionLabel = {sector:'赛道',sub:'细分',stage:'可比轮次',year:'案例年份',keyword:'关键词',investor:'机构名',sort:'排序'};
  const filterKeys = ['sector','sub','stage','mode','year','keyword','investor','cohort','sort','excludeUnknown'];

  function initialFilters(project) {
    const sector = project.sector === '待归类' ? '' : project.sector;
    return {sector:sector || '',sub:sector ? project.sub || '' : '',stage:project.stage || '',
      mode:'exact',year:'',keyword:project.keywords || '',investor:'',cohort:'new',sort:'evidence',excludeUnknown:false,adjacent:false};
  }

  function historyRows(company, companyId) {
    if (!company) return [];
    return company.events.filter(event => !clientStageExcluded.has(event[2])).map(event => {
      const [url,date,stage,amount,parties,,sector,sub] = event;
      const id = new URL(url,location.href).searchParams.get('id');
      return [id,company.name,[],date,sector,stage,amount,parties.map(p=>p[0]),null,sub,
        company.location,recordUrl('company',companyId),[]];
    });
  }

  function goalText(project) {
    const amount = value => [value,project.currency].filter(Boolean).join(' ');
    return [
      [project.stage,'目标轮次'], [project.amount && amount(project.amount),'拟募总额'],
      [project.ticket && amount(project.ticket),'期望单家票面'], [project.region,'地域与落地'],
    ].filter(([value])=>value);
  }

  async function start({form,list,count,load}) {
    const main = form.closest('main');
    const heading = document.querySelector('#work-title');
    const head = document.querySelector('#fa-match-project') || node('section');
    const context = document.querySelector('#work-context');
    const table = list.closest('table');
    const scroll = table.parentElement;
    const next = document.querySelector('#next'), prev = document.querySelector('#prev');
    const params = new URLSearchParams(location.search);
    const projectId = params.get('project');
    const adjacentIntent = params.get('scope') === 'adjacent';
    const projectPage = mode => 'projects.html?' + new URLSearchParams({project:projectId,...(mode?{tab:mode}:{})});
    const neutralLink = (label, href) => {const a=node('a',label);a.href=href;return a;};
    main.classList.add('workspace-project','fa-matching');
    if (!head.isConnected) context.before(head);
    head.hidden = false;
    heading.textContent = '正在读取项目…';
    scroll.hidden=true;
    prev.disabled=next.disabled=true;
    try {
      const [projectRecord, meta] = await Promise.all([faStore.getProject(projectId),load('manifest')]);
      if (!projectRecord) {
        heading.textContent='此设备未找到项目';
        form.hidden=true;
        count.textContent='可打开我的项目，或导入已保存的项目备份。';
        head.append(neutralLink('打开我的项目','projects.html'));
        return;
      }
      let project=projectRecord;
      let companyId=project.companyId, company=null;
      async function publicRecord(kind,id) {
        if (!recordId.test(id||'')) return null;
        return (await load(kind+'-'+id.slice(0,2)))[id] || null;
      }
      const fundsPromise = load('fa-funds');
      company=await publicRecord('company',companyId);
      if (recordId.test(company?.redirect || '')) {
        companyId=company.redirect;
        company=await publicRecord('company',companyId);
      }
      const fundIndex=await fundsPromise;
      const past=historyRows(company,companyId);
      const yearCache=new Map();
      const savedView=project.view || {};
      const restored={...initialFilters(project), ...savedView.filters};
      function canUseAdjacent(){
        return Boolean(project.sector&&project.sub&&
          !(company?.sub===project.sub&&company.hasFineDirection===false));
      }
      if(adjacentIntent && canUseAdjacent()){
        Object.assign(restored,{adjacent:true,sector:project.sector,sub:''});
      }
      let page=adjacentIntent?1:Math.max(1,Number(savedView.page)||1);
      let restoreOnce=!adjacentIntent, version=0, timer, scrollTimer;
      let saveChain=Promise.resolve();
      let applied={};
      let saved=new Map();
      let disposed=false;
      const status=node('p','','fa-save-status');
      status.setAttribute('role','status');
      if(adjacentIntent&&!canUseAdjacent())status.textContent='项目细分待核实。当前未执行相邻方向排除。';
      const shortlist=document.querySelector('#shortlist');
      const shortcut=neutralLink('清单 · 已选 0 项',projectPage('saved'));
      shortcut.className='fa-saved-shortcut';
      const controls=node('div','','fa-match-controls');
      const roles=node('div','','fa-cohorts');
      roles.setAttribute('role','group');roles.setAttribute('aria-label','候选范围');
      const modeButtons=new Map();
      const switches=node('div','','fa-match-switches');
      const sortSelect=node('select');
      sortSelect.setAttribute('aria-label','排序');
      const sortOptions={evidence:'优先证据相关',recent:'最近相关记录',cases:'相关案例数量'};
      Object.entries(sortOptions).forEach(([value,label])=>sortSelect.add(new Option(label,value)));
      const sortLabel=node('label','排序');sortLabel.append(sortSelect);
      const unknown=node('input');unknown.type='checkbox';unknown.setAttribute('aria-label','排除信息不足');
      const unknownLabel=node('label',' 排除信息不足','fa-unknown');
      unknownLabel.prepend(unknown);
      const adjacent=node('input');adjacent.type='checkbox';
      const adjacentLabel=node('label',' 同赛道其他已知细分','fa-unknown');
      adjacentLabel.prepend(adjacent);
      switches.append(sortLabel,unknownLabel);
      controls.append(roles,switches);
      const help=node('div','','fa-scope-help');
      const language=node('details','','fa-query');
      language.append(node('summary','用一句话修改检索条件'));
      const ask=node('form');
      const question=node('input');
      question.required=true;
      question.maxLength=240;
      question.placeholder='例如：2026 年投资过触觉传感的 A 轮资方';
      question.setAttribute('aria-label','描述检索条件');
      const parseButton=node('button','应用能识别的条件');
      const parsed=node('p','','fa-query-parsed');parsed.setAttribute('role','status');
      ask.append(question,parseButton);language.append(ask,parsed);
      const links=node('div','','fa-project-links');
      const goals=node('p','','fa-goal-summary');
      const navRow=node('div','','fa-match-shell');
      navRow.append(links,goals);
      head.replaceChildren(navRow,language);
      form.after(controls);
      context.after(status);
      scroll.before(help);
      shortlist.replaceWith(shortcut);
      const actionHost=form.querySelector('.work-filter-actions') || form;
      const saveConditions=button('保存为项目条件',saveGoalConditions);
      actionHost.append(saveConditions);
      const reset=form.querySelector('button[type=reset]');
      if (reset) reset.textContent='恢复项目条件';
      const privateUrl='workspace.html?'+new URLSearchParams({project:project.id});
      history.replaceState(null,'',privateUrl);
      if ('scrollRestoration' in history) history.scrollRestoration='manual';
      function contextLink(text, href, entity='') {
        const target=new URL(href,location.href);
        target.searchParams.set('project',project.id);
        target.searchParams.set('from','matches');
        const a=neutralLink(text,target.href);
        a.addEventListener('click',e=>{
          if (e.button!==0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          persist({anchorEntity:entity,scrollY:window.scrollY}).then(()=>location.assign(a.href), ()=>{
            status.textContent='保存工作位置失败。当前条件已保留，可重试打开。';
          });
        });
        return a;
      }

      function drawProject() {
        heading.textContent=project.title;
        document.title=project.title+' · 候选机构 · 观势';
        const issuer=company?.name || project.companyName;
        const items=[contextLink('项目条件与反馈',projectPage('saved'))];
        if (issuer && recordId.test(companyId)) items.unshift(contextLink(issuer,recordUrl('company',companyId)));
        links.replaceChildren(...items);
        goals.replaceChildren();
        for (const [value,label] of goalText(project)) goals.append(node('span',label+' '+value));
        if (!goals.children.length) goals.append(node('span','项目融资目标可在项目条件补充'));
      }

      const localFields=['sector','sub','stage','mode','year','keyword','investor'];
      form.elements.company.closest('label').hidden=true;
      form.elements.view.closest('label').hidden=true;
      form.elements.stage.closest('label').firstChild.textContent='对照轮次';
      form.elements.investor.placeholder='机构名称或别名';
      const keyword=node('input');keyword.name='keyword';keyword.maxLength=200;keyword.placeholder='案例业务或名称';
      const keywordLabel=node('label','业务关键词');keywordLabel.append(keyword);
      form.elements.stage.closest('label').after(keywordLabel);
      for (const [key, values] of [['sector',meta.sectors],['year',meta.years]]) {
        for (const value of values) form.elements[key].add(new Option(value,value));
      }
      const rounds=form.elements.mode;
      rounds.replaceChildren(new Option('精确对照','exact'),new Option('同轮次系列','family'),new Option('关键词对照','keyword'));
      const advanced=node('details','','fa-match-more');
      advanced.append(node('summary','更多检索条件'));
      const advancedBody=node('div','','fa-match-more-fields');
      advancedBody.append(keywordLabel,form.elements.year.closest('label'),rounds.closest('label'),adjacentLabel);
      adjacentLabel.hidden=!canUseAdjacent();
      advanced.append(advancedBody);
      actionHost.before(advanced);
      if (restored.year || restored.keyword || restored.mode!=='exact' || restored.adjacent) advanced.open=true;
      let cohort='new';

      function directionOptions(sector) {
        const possible=sector?meta.subs[sector]||[]:[...new Set(Object.values(meta.subs).flat())].sort();
        form.elements.sub.replaceChildren(new Option('全部方向',''),...possible.map(s=>new Option(s,s)));
      }
      function updateRoles() {
        for(const [key,control] of modeButtons) control.setAttribute('aria-pressed',String(key===cohort));
      }
      for(const [key,label] of Object.entries(cohorts)){
        const control=button(label,()=>{cohort=key;updateRoles();change();});
        modeButtons.set(key,control);roles.append(control);
      }
      function apply(values) {
        const clean=sectorFilter.resolve(values.sector||'',values.sub||'');
        sectorFilter.setValue(form.elements.sector,clean.sector);
        directionOptions(clean.sector);
        sectorFilter.setValue(form.elements.sub,clean.sub);
        for(const key of ['stage','keyword','investor','year','mode']){
          const field=form.elements[key];
          field.value=values[key]||(key==='mode'?'exact':'');
        }
        cohort=Object.hasOwn(cohorts,values.cohort)?values.cohort:'new';
        updateRoles();
        sortSelect.value=Object.hasOwn(sortOptions,values.sort)?values.sort:'evidence';
        unknown.checked=Boolean(values.excludeUnknown);
        adjacent.checked=Boolean(values.adjacent)&&canUseAdjacent()&&clean.sector===project.sector&&!clean.sub;
      }

      function readFilters() {
        const values=Object.fromEntries(localFields.map(k=>[k,form.elements[k].value.trim()]));
        return {...values,cohort,sort:sortSelect.value,excludeUnknown:unknown.checked,
          adjacent:adjacent.checked&&canUseAdjacent()&&values.sector===project.sector&&!values.sub};
      }

      let queryNote=savedView.query || null;
      if(queryNote){
        question.value=queryNote.text || '';
        parsed.textContent=queryNote.message || '';
        language.open=true;
      }
      function persist(extra={}) {
        const payload={filters:readFilters(),page,query:queryNote,...extra};
        const nextSave=saveChain.catch(()=>{}).then(()=>faStore.saveView(project.id,payload));
        saveChain=nextSave;
        return nextSave;
      }

      async function saveGoalConditions() {
        saveConditions.disabled=true;
        status.textContent='正在保存项目条件…';
        const current=readFilters();
        const {sector,stage,keyword:keywords}=current;
        const sub=current.adjacent?project.sub:current.sub;
        try {
          project=await faStore.updateProject(project.id,{sector,sub,stage,keywords},project.revision);
          adjacentLabel.hidden=!canUseAdjacent();
          if(!canUseAdjacent())adjacent.checked=false;
          drawProject();
          status.textContent='赛道、细分、轮次和业务关键词已保存为项目条件。';
        } catch {
          const latest=await faStore.getProject(project.id).catch(()=>null);
          if(latest && latest.revision!==project.revision){
            project=latest;drawProject();
            status.textContent='项目已在别处更新。当前条件已保留，请确认后再次保存。';
          } else status.textContent='保存项目条件失败。当前条件已保留，可再次保存。';
        } finally{saveConditions.disabled=false;}
      }

      async function fetchYears(values, seq) {
        if ((!values.sector && !values.sub && !values.investor && !values.keyword)) return [];
        const years=values.year?[values.year]:meta.years;
        const records=[];
        for(let i=0;i<years.length;i+=4){
          const batch=await Promise.all(years.slice(i,i+4).map(y=>{
            if(!yearCache.has(y))yearCache.set(y,load('search-'+y).catch(e=>{yearCache.delete(y);throw e;}));
            return yearCache.get(y);
          }));
          if(seq!==version)return [];
          for(const rows of batch)records.push(...rows);
        }
        return records;
      }

      const identityCache=new Map();
      async function fillIdentity(group) {
        if (group.id) return group;
        if(!identityCache.has(group.name)){
          identityCache.set(group.name,crypto.subtle.digest('SHA-256',new TextEncoder().encode('institution'+group.name))
            .then(data=>Array.from(new Uint8Array(data).slice(0,12),b=>b.toString(16).padStart(2,'0')).join('')));
        }
        group.id=await identityCache.get(group.name);
        return group;
      }

      const keyOf=(type,id)=>type+':'+id;
      function syncButtons() {
        const active=[...saved.values()].filter(c=>!c.removedAt).length;
        shortcut.textContent='清单 · 已选 '+active+' 项';
        for(const b of list.querySelectorAll('.pick[data-candidate]')){
          if(b.disabled) continue;
          const item=saved.get(b.dataset.candidate);
          const action=item?.removedAt?'恢复到清单':item?'已加入':'加入清单';
          b.textContent=action;
          b.setAttribute('aria-label',action+' '+b.dataset.candidateName);
          b.setAttribute('aria-pressed',String(Boolean(item&&!item.removedAt)));
        }
      }
      async function readSaved() {
        const rows=await faStore.listCandidates(project.id,{includeRemoved:true});
        saved=new Map(rows.map(item=>[keyOf(item.entityType,item.entityId),item]));
        syncButtons();
      }

      function explain(group) {
        const reasons=[];
        if (group.historical) reasons.push('本站已有本公司具名历史参投记录');
        if (group.peerCount) reasons.push(group.peerCount+' 笔相关公开案例');
        const fit=group.checks.filter(c=>c.state==='fit').map(c=>c.text);
        if (fit.length) reasons.push(fit.join('、'));
        if (!reasons.length) reasons.push('所选条件下有公开投资记录');
        return reasons.join('；')+'。';
      }
      function followUp(group) {
        const check=group.checks.filter(c=>c.state==='unknown').map(c=>c.label);
        const base=group.historical?'确认当前是否仍持股、追加权限及实际决策团队。':'确认本轮投资意向、当前可投主体及额度。';
        return base+(check.length?'补核'+check.join('、')+'。':'');
      }

      async function snapshot(entry) {
        const {row,funds}=entry;
        const deal=await publicRecord('deal',row[0]);
        if (!deal) throw Error('案例未能读取');
        const fund=[...funds.values()][0];
        const sources=(deal.sources||[]).filter(url=>/^https?:\/\//i.test(url));
        return {
          id:row[0], title:deal.company || row[1], date:deal.day || row[3], href:casesUrl(row[0]), sources,
          companyId:caseCompany(deal.companyHref || row[11]),stage:deal.stage || row[5],dateKind:deal.dateKind || '',sector:deal.sector || row[4],
          sub:deal.sub || row[9],parties:[...(deal.investors || row[7])],fundId:fund?.id || '', fundName:fund?.name || '',
        };
      }
      function sourceLink(url,label) {
        const link=neutralLink(label,url);link.rel='noopener noreferrer';
        link.target='_blank';return link;
      }
      function evidenceDetails(group) {
        const panel=node('details','','fa-case-evidence');
        panel.append(node('summary','依据与案例'));
        let loaded=false;
        panel.ontoggle=async()=>{
          if(!panel.open||loaded)return;
          loaded=true;
          const body=node('div','','fa-evidence-body');
          const why=node('p',explain(group));
          body.append(why);
          if(group.funds.length){
            const list=node('ul','','fa-evidence-list');
            for(const fund of group.funds){
              const li=node('li');
              li.append(contextLink(fund.name,recordUrl('institution',fund.id),group.id));
              if(/^https?:\/\//i.test(fund.source||'')) li.append(' · ',sourceLink(fund.source,'管理关系来源'));
              list.append(li);
            }
            body.append(node('h4','具体基金'),list);
          }
          if(group.checks.length){
            const assessments=node('ul','','fa-evidence-list');
            for(const check of group.checks)assessments.append(node('li',check.label+' · '+check.text));
            body.append(assessments);
          }
          const citations=node('div','读取交易来源…');
          body.append(citations,node('p','联系前 · '+followUp(group)));
          if(group.peerCount)body.append(node('p','相关案例仅供核对业务重叠与信息隔离要求。'));
          if(group.historical)body.append(node('p','参投来自历史披露，当前持股情况另核。'));
          panel.append(body);
          try{
            const snap=await Promise.all(group.relevantCases.slice(0,3).map(snapshot));
            const caseList=node('ul','','fa-evidence-list');
            for(const item of snap){
              const li=node('li');
              li.append(contextLink([item.title,item.date,item.stage].filter(Boolean).join(' · '),item.href,group.id));
              if(item.dateKind)li.append(node('small',item.dateKind));
              if(item.fundName)li.append(node('small','具体基金 · '+item.fundName));
              if(item.sources.length){
                const refs=node('div','','fa-source-links');
                for(const url of item.sources.slice(0,3)){
                  try{refs.append(sourceLink(url,new URL(url).hostname+' ↗'));}catch{}
                }
                li.append(refs);
              }else li.append(node('small','此案例未附原文链接'));
              caseList.append(li);
            }
            citations.replaceChildren(caseList);
          }catch{
            body.remove();
            loaded=false;
            panel.append(node('p','案例来源暂时无法读取，收起后可重试。','fa-evidence-error'));
            panel.addEventListener('toggle',()=>panel.querySelector('.fa-evidence-error')?.remove(),{once:true});
          }
        };
        return panel;
      }

      async function choose(group, control) {
        const id=group.id, type=group.type, atClick={...applied};
        const existing=saved.get(keyOf(type,id));
        if(existing&&!existing.removedAt){
          try{
            await persist({anchorEntity:id,scrollY:window.scrollY});
            location.assign(projectPage('saved'));
          }catch{status.textContent='保存工作位置失败。已选内容保留，可重试。';}
          return;
        }
        control.disabled=true;
        status.textContent='正在保存候选…';
        control.textContent='正在保存…';
        try {
          if(existing?.removedAt)await faStore.restoreCandidate(project.id,type,id);
          else {
            const evidence=await Promise.all(group.relevantCases.slice(0,3).map(snapshot));
            await faStore.saveCandidate(project.id,{
              entityType:type,entityId:id,name:group.name,systemReason:explain(group),userReason:'',
              evidence,funds:group.funds.map(fund=>({id:fund.id,name:fund.name,href:recordUrl('institution',fund.id),source:fund.source})),
              concerns:group.peerCount?'核实项目与相关被投企业的业务重叠及信息隔离要求。':'',
              nextAction:followUp(group),status:'待联系',selection:atClick,
            });
          }
          await readSaved();
          status.textContent=existing?.removedAt?'已恢复到项目清单。':'已保存候选及入选依据。';
        }catch{
          status.textContent='保存候选失败，当前条件和结果仍保留。可再次点击加入。';
        }finally{
          control.disabled=false;
          syncButtons();
        }
      }

      function tag(check) {
        const labels={fit:'有依据',different:'案例不同',unknown:'待核'};
        const el=node('span',check.label+' · '+labels[check.state],'fa-check '+check.state);
        el.title=check.text;
        return el;
      }
      function rowFor(group) {
        const tr=node('tr');tr.id='candidate-'+group.id;
        const name=node('th');name.scope='row';
        name.append(contextLink(group.name,recordUrl('institution',group.id),group.id));
        if(group.historical)name.append(node('small','已披露历史参投','fa-case-meta'));
        if(group.funds.length)name.append(node('small',group.funds.length+' 只具名基金','fa-case-meta'));
        const match=node('td','','fa-match-basis');
        for(const check of group.checks)match.append(tag(check));
        if(!group.checks.length)match.append(node('span','匹配条件待核','fa-check unknown'));
        const proofs=node('td','','latest-case');
        const r=group.recent?.row;
        if(r){
          const meta=node('small','','fa-case-meta');
          const time=node('time',r[3]||'日期未列明');
          if(/^\d{4}(?:-\d{2}){0,2}$/.test(r[3])) time.dateTime=r[3];
          meta.append(time);
          if(r[5])meta.append(' · '+r[5]);
          proofs.append(contextLink(r[1],casesUrl(r[0]),group.id),meta);
        }
        proofs.append(evidenceDetails(group));
        const pick=node('td');
        const action=button('加入清单',()=>choose(group,action),'pick');
        action.dataset.candidate=keyOf(group.type,group.id);
        action.dataset.candidateName=group.name;
        pick.append(action);
        tr.append(name,match,proofs,pick);
        return tr;
      }

      function explainScope(values, result){
        const applied=Object.keys(conditionLabel).filter(key=>key!=='sort'&&values[key])
          .map(key=>conditionLabel[key]+' '+values[key]);
        const role={new:'排除本站已披露的本公司历史资方',follow:'仅看已披露历史资方，包含其原参投记录',all:'同时查看新增机构与历史资方'}[values.cohort];
        context.textContent=(applied.length?'检索条件 · '+applied.join(' / ')+ '。':'请选赛道、业务关键词或具名机构。')+' '+role+'。历史参投的当前持股待核。'+
          (values.adjacent?' 相邻筛选已排除「'+project.sub+'」及未标注细分的案例。':'');
        if(!result) return;
        const labels=[result.unknownKept?'保留 '+result.unknownKept.toLocaleString()+' 家含待核条件': '',
          result.unknownExcluded?'已排除 '+result.unknownExcluded.toLocaleString()+' 家含待核条件':''];
        const details=labels.some(Boolean)?node('p',labels.filter(Boolean).join(' · '),'fa-result-notes'):null;
        const actions=node('div','','fa-widen-actions');
        help.replaceChildren(...[details,actions].filter(Boolean));
        if(result.groups.length>=8) return;
        if(values.excludeUnknown) actions.append(button('保留信息不足',()=>{unknown.checked=false;change();}));
        if(values.sub||values.adjacent) actions.append(button('扩大到同赛道',()=>{form.elements.sub.value='';adjacent.checked=false;change();}));
        if(values.year) actions.append(button('不限案例年份',()=>{form.elements.year.value='';change();}));
        if(values.investor) actions.append(button('清除机构名',()=>{form.elements.investor.value='';change();}));
        if(!result.groups.length && values.cohort==='follow' && !result.historicalCount){
          actions.before(node('p','现有公司档案没有具名历史资方。'));
          actions.append(button('查看新增机构',()=>{cohort='new';updateRoles();change();}));
        }
        if(!values.sector && !values.sub && !values.investor && !values.keyword){
          actions.before(node('p','选择一个赛道、关键词或机构名称后，可查看有依据的新增候选。'));
        }
      }

      const headRow=table.tHead.rows[0];
      headRow.replaceChildren(...['机构','匹配条件','最近相关案例','清单'].map(title=>{
        const th=node('th',title);th.scope='col';return th;
      }));
      const cols=node('colgroup');
      for(let i=0;i<4;i++)cols.append(node('col'));
      table.prepend(cols);
      table.classList.add('grouped-results','fa-match-grid');
      function restorePosition(){
        if(!restoreOnce)return;
        restoreOnce=false;
        const anchor=recordId.test(savedView.anchorEntity||'')&&document.getElementById('candidate-'+savedView.anchorEntity);
        if(Number.isFinite(savedView.scrollY) && savedView.scrollY>0)window.scrollTo(0,savedView.scrollY);
        if(anchor && (anchor.getBoundingClientRect().bottom<0||anchor.getBoundingClientRect().top>innerHeight)){
          anchor.scrollIntoView({block:'center'});
        }
      }

      function loading(filters){
        scroll.hidden=true;
        scroll.setAttribute('aria-busy','true');
        prev.disabled=next.disabled=true;
        count.textContent='正在检索公开融资案例…';
        help.replaceChildren();
        explainScope(filters);
      }
      async function show(){
        const seq=++version;
        const filters=readFilters();
        loading(filters);
        try{
          const records=await fetchYears(filters,seq);
          if(seq!==version||disposed)return;
          const result=analyze({rows:records,historyRows:past,filters,project,fundIndex,aliases:meta.institutionAliases,sectorFilter});
          const total=result.groups.length,pages=Math.max(1,Math.ceil(total/24));
          page=Math.min(page,pages);
          const candidates=await Promise.all(result.groups.slice((page-1)*24,page*24).map(fillIdentity));
          if(seq!==version||disposed)return;
          applied=filters;
          list.replaceChildren(...candidates.map(rowFor));
          syncButtons();
          count.textContent=total?total.toLocaleString()+' 家候选机构 · 第 '+page+' / '+pages+' 页':'当前条件下没有候选机构';
          count.dataset.count=String(total);
          explainScope(filters,result);
          scroll.hidden=!total;
          prev.disabled=page<=1;next.disabled=page>=pages;
          if (restoreOnce) requestAnimationFrame(restorePosition);
          else persist({anchorEntity:''}).catch(()=>{status.textContent='保存浏览位置失败，可继续使用当前结果。';});
        }catch{
          if(seq!==version)return;
          count.textContent='融资案例检索失败，当前条件已保留。';
          help.replaceChildren(button('重试检索',()=>show()));
        }finally{
          if(seq===version)scroll.setAttribute('aria-busy','false');
        }
      }

      function change(){
        page=1;
        version++;
        restoreOnce=false;
        loading(readFilters());
        clearTimeout(timer);
        timer=setTimeout(show,160);
        clearTimeout(scrollTimer);
        persist({scrollY:0,anchorEntity:''}).catch(()=>{status.textContent='保存筛选失败，当前条件已保留。';});
      }

      form.elements.sector.addEventListener('input',()=>{
        directionOptions(form.elements.sector.value);
        if(form.elements.sector.value!==project.sector)adjacent.checked=false;
      });
      form.elements.sub.addEventListener('input',()=>{if(form.elements.sub.value)adjacent.checked=false;});
      form.oninput=change;
      form.onsubmit=e=>{e.preventDefault();change();};
      form.onreset=e=>{
        e.preventDefault();queryNote=null;question.value='';parsed.textContent='';
        language.open=false;advanced.open=false;status.textContent='';
        apply(initialFilters(project));change();
      };
      sortSelect.onchange=change;
      unknown.onchange=change;
      adjacent.onchange=()=>{
        if(adjacent.checked){
          sectorFilter.setValue(form.elements.sector,project.sector);
          directionOptions(project.sector);
        }
        change();
      };
      ask.onsubmit=e=>{
        e.preventDefault();
        const result=parseQuery(question.value,meta,readFilters());
        const message=[result.found.length?'已应用 '+result.found.join('、'):'未识别出可直接应用的条件',
          result.unresolved?'待核实或未识别 · '+result.unresolved:''].filter(Boolean).join('。');
        parsed.textContent=message;
        queryNote={text:question.value,message};
        if(result.found.length){apply(result.filters);change();}
        else persist().catch(()=>{status.textContent='保存检索说明失败，当前输入仍保留。';});
      };
      prev.onclick=()=>{page--;goPage();};
      next.onclick=()=>{page++;goPage();};
      function goPage(){
        restoreOnce=false;
        count.scrollIntoView({block:'nearest'});
        persist({anchorEntity:'',scrollY:window.scrollY}).catch(()=>{});
        show();
      }
      shortcut.addEventListener('click',e=>{
        if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
        e.preventDefault();
        persist({scrollY:window.scrollY}).then(()=>location.assign(shortcut.href),()=>{
          status.textContent='保存工作位置失败。当前候选仍保留，可重试打开清单。';
        });
      });
      window.addEventListener('scroll',()=>{
        if(restoreOnce || scroll.hidden)return;
        clearTimeout(scrollTimer);
        scrollTimer=setTimeout(()=>persist({scrollY:window.scrollY}).catch(()=>{}),180);
      },{passive:true});
      let savedTimer;
      const unsubscribe=faStore.subscribe(()=>{
        clearTimeout(savedTimer);
        savedTimer=setTimeout(()=>readSaved().catch(()=>{}),120);
      });
      window.addEventListener('pagehide',event=>{
        if(event.persisted)return;
        disposed=true;
        unsubscribe();
        clearTimeout(savedTimer);
      });
      apply(restored);
      if(adjacentIntent&&canUseAdjacent())persist({scrollY:0,anchorEntity:''}).catch(()=>{});
      drawProject();
      await readSaved();
      show();
    }catch{
      heading.textContent='项目工作区暂时无法读取';
      count.textContent='请刷新重试，或回到我的项目检查本机保存。';
      head.replaceChildren(neutralLink('打开我的项目','projects.html'));
      form.hidden=true;
    }
  }

  return {analyze, parseQuery, start};
})();
