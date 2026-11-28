(() => {
  const root = document.getElementById('investor-judgments');
  if (!root) return;
  const id24 = /^[a-f0-9]{24}$/;
  const localId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const sectorId = /^[a-z][a-z0-9-]{0,48}$/;
  const reportAnchor = /^report-[a-z0-9-]+\.html#evidence-[a-z0-9-]+$/;
  const labels = {company:'公司', institution:'机构', sector:'赛道', comparison:'公司比较', project:'融资项目'};
  const params = new URLSearchParams(location.search);
  const fields = [
    ['title', '研究问题', 180],
    ['opinion', '当前判断', 4000],
    ['trigger', '可能改变判断的证据', 2000],
    ['nextAction', '下一步验证', 2000],
  ];
  const button = (label, handler) => {
    const node = el('button', label);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };
  const safeText = value => typeof value === 'string' ? value : '';
  let notes = [], context, active, targets = [], citations = [], dirty = false, busy = false, evidenceVersion = 0;
  let projects = [], comparisons = [], watches = [], unsavedTargetOptions = [];
  let refreshCitations = () => {};
  const editor = el('section', '', 'investor-judgment-editor');
  const list = el('section', '', 'investor-judgment-list');
  const related = el('aside', '', 'investor-judgment-related');
  const notice = el('p', '', 'investor-evidence-muted');
  notice.setAttribute('role', 'status');

  function el(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value ?? '';
    if (className) node.className = className;
    return node;
  }

  function action(label, href) {
    const node = el('a', label);
    node.href = href;
    node.referrerPolicy = 'no-referrer';
    return node;
  }

  function targetHref(type, id) {
    if (['company', 'institution'].includes(type) && id24.test(id)) return type+'.html?id='+id;
    if (type === 'sector' && sectorId.test(id)) return 'search.html?sector='+id;
    if (type === 'comparison' && localId.test(id)) return 'compare.html?id='+id;
    if (type === 'project' && localId.test(id)) return 'projects.html?project='+id;
    return '';
  }

  function cleanTarget(target) {
    if (!target || !Object.hasOwn(labels, target.type)) return null;
    const href = targetHref(target.type, target.id);
    return href ? {type:target.type,id:target.id,name:safeText(target.name).slice(0,240),href} : null;
  }

  function citationHref(value) {
    const input = safeText(value).trim();
    if (reportAnchor.test(input) || /^deal\.html\?id=[a-f0-9]{24}$/.test(input)) return input;
    if (!/^https?:\/\//i.test(input)) return '';
    try {
      const url = new URL(input);
      if (url.username || url.password) return '';
      if (url.origin === location.origin) {
        const base = new URL('.', location.href);
        if (!url.pathname.startsWith(base.pathname)) return '';
        const path = url.pathname.slice(base.pathname.length) + url.search + url.hash;
        return reportAnchor.test(path) || /^deal\.html\?id=[a-f0-9]{24}$/.test(path) ? path : '';
      }
      return url.href;
    } catch {
      return '';
    }
  }

  function cleanEvidence(items) {
    if (!Array.isArray(items)) return [];
    return items.flatMap(item => {
      const href = citationHref(item?.href || item?.url);
      return href ? [{href, title:safeText(item.title || href).slice(0,300),
                      ...(id24.test(item.evidenceId || '') ? {evidenceId:item.evidenceId} : {}),
                      ...(Array.isArray(item.sources) ? {sources:item.sources.map(citationHref).filter(Boolean)} : {})}] : [];
    });
  }

  async function resolveContext() {
    const type = params.get('type');
    let target = cleanTarget({type,id:params.get('id') || ''});
    if (!target) return null;
    const {id} = target;
    if (type === 'project') {
      const project = projects.find(item => item.id === id);
      if (!project) throw new Error('当前浏览器找不到对应项目。');
      return {...target,name:project.title};
    }
    if (type === 'comparison') {
      const comparison = comparisons.find(item => item.id === id);
      if (!comparison) throw new Error('当前浏览器找不到对应比较。');
      return {...target,name:comparison.name || comparison.title};
    }
    if (type === 'sector') {
      const known = watches.map(row => cleanTarget(row.target)).find(item => item?.type === type && item.id === id);
      const sector = typeof sectorFilter !== 'undefined' && sectorFilter.resolve(id);
      const resolved = sector?.sector !== id ? sector?.sector : '';
      return {...target,name:known?.name || resolved || id};
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch('records/'+type+'-'+target.id.slice(0,2)+'.json');
      if (!response.ok) throw new Error('关联档案暂时无法读取。');
      const data = await response.json();
      const record = Object.hasOwn(data, target.id) ? data[target.id] : null;
      if (!record) throw new Error('未找到关联档案。');
      if (!record.redirect) return {...target,name:record.name};
      target = cleanTarget({type,id:record.redirect});
      if (!target) break;
    }
    throw new Error('关联档案已迁移，暂时无法定位。');
  }

  function filterNotes() {
    if (!context) return notes;
    return notes.filter(note => note.targets?.some(target => target.type === context.type && target.id === context.id));
  }

  function redrawList() {
    const heading = el('div', '', 'investor-evidence-heading');
    heading.append(el('h2', context ? '此对象的判断' : '已保存判断'), button('新建', () => show(null, {focus:true})));
    list.replaceChildren(heading);
    const saved = filterNotes();
    if (!saved.length) list.append(el('p', '暂无记录。', 'investor-evidence-muted'));
    for (const note of saved) {
      const row = button(note.title || '未命名判断', () => show(note, {focus:true}));
      if (active?.id === note.id) row.setAttribute('aria-current', 'true');
      const updated = investorEvidence.asDay(note.updatedAt);
      if (updated) row.append(el('small', updated));
      list.append(row);
    }
    if (context) list.append(action('查看全部判断', 'judgments.html'));
  }

  function evidenceFor(note, selected = targets) {
    const version = ++evidenceVersion;
    related.replaceChildren(el('h2', '相关证据'));
    const message = el('p', '正在读取证据…', 'investor-evidence-muted');
    message.setAttribute('role', 'status');
    related.append(message);
    if (!selected.length) {
      message.textContent = '关联对象后可查看融资证据。';
      return;
    }
    const projectIds = new Set(selected.filter(target => target.type === 'project').map(target => target.id));
    Promise.all([...projectIds].map(id => faStore.listCandidates(id)))
      .then(candidates => investorEvidence.loadRelated({
        judgments:[{title:note?.title, targets:selected}], comparisons, projects:projects.filter(project => projectIds.has(project.id)), candidates,
      }))
      .then(result => {
        if (version !== evidenceVersion) return;
        message.textContent = investorEvidence.statusText(result.status, true) || investorEvidence.coverageText(result.coverage);
        if (result.status === 'error') related.append(button('重试', () => evidenceFor(note)));
        if (result.status === 'empty') related.append(el('p', investorEvidence.coverageText(result.coverage), 'investor-evidence-muted'));
        if (result.status !== 'ready') return;
        const alreadySaved = new Set(citations.map(item => item.evidenceId));
        const asOf = investorEvidence.asDay(note?.createdAt);
        const items = result.items.filter(item => !alreadySaved.has(item.signalId || item.id));
        const newItems = asOf ? items.filter(item => item.changeDate > asOf) : items;
        const otherItems = asOf ? items.filter(item => item.changeDate <= asOf) : [];
        if (!newItems.length) related.append(el('p', '当前公开范围内，暂无保存日期之后的其他匹配证据。'));
        function cite(item) {
          const evidenceId = item.signalId || item.id;
          if (citations.some(entry => entry.evidenceId === evidenceId)) return;
          citations.push({href:item.href,title:item.title,evidenceId,
                          sources:(item.sources || []).map(source => citationHref(source.url)).filter(Boolean)});
          dirty = true;
          refreshCitations();
          message.textContent = '证据已加入编辑表单，保存判断后保留。';
        }
        for (const item of newItems.slice(0,4)) related.append(investorEvidence.renderItem(item, {addEvidence:cite}));
        if (otherItems.length) {
          const earlier = el('details', '', 'investor-evidence-detail');
          earlier.append(el('summary', '较早的相关出处'));
          for (const item of otherItems.slice(0,4)) earlier.append(investorEvidence.renderItem(item, {addEvidence:cite}));
          related.append(earlier);
        }
        related.append(action('查看公开变化追踪', 'changes.html#investor-evidence'));
      })
      .catch(() => {
        if (version !== evidenceVersion) return;
        message.textContent = '无法读取关联对象的清单。请重试。';
        related.append(button('重试', () => evidenceFor(note)));
      });
  }

  function show(note, {force = false, focus = false} = {}) {
    if (busy) return;
    if (dirty && !force && !window.confirm('当前还有未保存输入，放弃后打开其他判断？')) return;
    active = note;
    dirty = false;
    targets = (note?.targets || (context ? [context] : [])).map(cleanTarget).filter(Boolean);
    citations = cleanEvidence(note?.evidence);
    if (!note && reportAnchor.test(params.get('source') || '')) {
      citations.push({href:params.get('source'),title:'周报证据'});
    }
    const heading = el('h2', note ? '编辑研究判断' : '新建研究判断');
    const form = el('form', '', 'investor-judgment-form');
    const inputs = {};
    for (const [key, label, limit] of fields) {
      const line = el('label', label);
      const input = el(key === 'title' ? 'input' : 'textarea');
      input.required = key === 'title';
      input.value = safeText(note?.[key]);
      input.maxLength = limit;
      if (key !== 'title') input.rows = 2;
      inputs[key] = input;
      line.append(input);
      form.append(line);
    }

    const associations = el('section', '', 'investor-judgment-associations');
    const targetList = el('ul');
    function renderTargets() {
      targetList.replaceChildren();
      for (const target of targets) {
        const row = el('li');
        const remove = button('移除', () => {
          targets = targets.filter(item => item.type !== target.type || item.id !== target.id);
          dirty = true;
          renderTargets();
          pick.focus();
          evidenceFor(active);
        });
        remove.setAttribute('aria-label', '移除关联 '+(target.name || labels[target.type]));
        row.append(action(target.name || labels[target.type], target.href), remove);
        targetList.append(row);
      }
      pick.replaceChildren(new Option('添加已保存的对象', ''));
      const used = new Set(targets.map(target => target.type+':'+target.id));
      for (const choice of unsavedTargetOptions) {
        if (!used.has(choice.type+':'+choice.id)) {
          pick.append(new Option(labels[choice.type]+' · '+(choice.name || choice.id), choice.type+':'+choice.id));
        }
      }
    }
    const pick = el('select');
    pick.setAttribute('aria-label', '添加已保存的关联对象');
    pick.addEventListener('change', () => {
      const chosen = unsavedTargetOptions.find(item => item.type+':'+item.id === pick.value);
      if (!chosen) return;
      targets.push(chosen);
      dirty = true;
      renderTargets();
      evidenceFor(active);
    });
    renderTargets();
    associations.append(el('h3', '关联对象'), targetList, pick);

    const proof = el('section', '', 'investor-judgment-associations');
    const citationList = el('ul');
    function renderCitations() {
      citationList.replaceChildren();
      for (const entry of citations) {
        const row = el('li');
        const remove = button('移除', () => {
          citations = citations.filter(item => item !== entry);
          dirty = true;
          renderCitations();
          citationInput.focus();
        });
        remove.setAttribute('aria-label', '移除证据 '+entry.title);
        const labeled = el('div');
        labeled.append(action(entry.title, entry.href));
        if (entry.sources?.length) {
          const sources = el('details');
          sources.append(el('summary', '引用时的出处'));
          for (const href of entry.sources) {
            const line = el('div');
            line.append(action(new URL(href, location.href).hostname, href));
            sources.append(line);
          }
          labeled.append(sources);
        }
        row.append(labeled, remove);
        citationList.append(row);
      }
    }
    const citationInput = el('input');
    citationInput.inputMode = 'url';
    citationInput.maxLength = 1400;
    const citationLabel = el('label', '来源链接');
    citationLabel.append(citationInput);
    const result = el('p', '', 'investor-evidence-muted');
    result.setAttribute('role', 'status');
    const addCitation = button('添加来源', () => {
      const href = citationHref(citationInput.value);
      if (!href) { result.textContent = '请输入有效的公开来源链接。'; citationInput.focus(); return; }
      if (!citations.some(item => item.href === href)) {
        citations.push({href,title:href});
        dirty = true;
        renderCitations();
      }
      result.textContent = '来源已加入，保存判断后保留。';
      citationInput.value = '';
    });
    citationInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); addCitation.click(); }
    });
    const citationControls = el('div', '', 'investor-evidence-actions');
    citationControls.append(citationLabel, addCitation);
    proof.append(el('h3', '支持证据'), citationList, citationControls);
    refreshCitations = renderCitations;
    renderCitations();

    const submit = el('button', '保存判断', 'investor-judgment-primary');
    submit.type = 'submit';
    const controls = el('div', '', 'investor-evidence-actions');
    const copy = button('另存为新判断', () => save(true));
    copy.hidden = true;
    controls.append(submit, copy, result);
    form.append(associations, proof, controls);
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('submit', event => { event.preventDefault(); save(false); });

    async function save(asCopy) {
      if (busy || !form.reportValidity()) return;
      const values = Object.fromEntries(fields.map(([key]) => [key, inputs[key].value.trim()]));
      if (!values.title) { result.textContent = '请填写研究问题。'; inputs.title.focus(); return; }
      if (citationInput.value.trim()) {
        result.textContent = '请先添加或清空来源输入，再保存判断。';
        citationInput.focus();
        return;
      }
      busy = true;
      submit.disabled = true;
      copy.disabled = true;
      result.textContent = '正在保存…';
      try {
        const prior = asCopy ? null : active;
        const priorOpinions = prior?.priorOpinions || [];
        const revised = prior && ['title','opinion','trigger','nextAction'].some(key => values[key] !== safeText(prior[key]));
        const item = await faStore.saveResearch('judgment', {
          id:prior?.id || crypto.randomUUID(), ...values, targets, evidence:citations,
          priorOpinions:revised ? [...priorOpinions, Object.fromEntries(
            [...fields.map(([key]) => key),'updatedAt','evidence'].map(key => [key, prior[key] ?? '']))] : priorOpinions,
        }, prior?.revision ?? null);
        notes = [item, ...notes.filter(note => note.id !== item.id)];
        history.replaceState(null, '', 'judgments.html?judgment='+item.id);
        busy = false;
        show(item, {force:true});
        notice.textContent = '判断已保存。数据保存在此设备的当前浏览器。';
        editor.querySelector('h2').focus();
      } catch (error) {
        result.textContent = error?.code === 'conflict' ? '另一个窗口已更新这条判断。当前输入仍在，可另存一条。' :
          '暂时无法保存判断，当前输入已保留。';
        copy.hidden = error?.code !== 'conflict';
      } finally {
        busy = false;
        submit.disabled = false;
        copy.disabled = false;
      }
    }

    heading.tabIndex = -1;
    editor.replaceChildren(heading, form);
    if (Array.isArray(note?.priorOpinions) && note.priorOpinions.length) {
      const archive = el('details', '', 'investor-evidence-detail investor-judgment-history');
      archive.append(el('summary', '此前判断'));
      for (const past of [...note.priorOpinions].reverse()) {
        const content = el('div');
        const snapshot = el('dl', '', 'investor-evidence-dates');
        for (const [key, label] of fields) {
          if (!past[key]) continue;
          const row = el('div');
          row.append(el('dt', label), el('dd', past[key]));
          snapshot.append(row);
        }
        content.append(el('h3', investorEvidence.asDay(past.updatedAt) || '日期未知'),snapshot);
        for (const proof of cleanEvidence(past.evidence)) content.append(action(proof.title, proof.href));
        archive.append(content);
      }
      editor.append(archive);
    }
    redrawList();
    evidenceFor(note);
    if (focus) heading.focus();
  }

  async function start() {
    notice.textContent = '正在读取此浏览器上的判断…';
    try {
      [notes, projects, comparisons, watches] = await Promise.all([
        faStore.listResearch('judgment'), faStore.listProjects(), faStore.listResearch('comparison'), faStore.listResearch('watch'),
      ]);
    } catch {
      notice.textContent = '暂时无法读取此浏览器上的研究资料。';
      root.append(button('重试', () => { root.replaceChildren(notice, layout); start(); }));
      return;
    }
    notice.textContent = '判断和备注保存在此设备的当前浏览器，可通过我的项目备份。';
    try {
      context = await resolveContext();
    } catch (error) {
      notice.textContent = error.message;
    }
    unsavedTargetOptions = [
      ...(context ? [context] : []),
      ...watches.map(row => row.target), ...notes.flatMap(note => note.targets || []),
      ...projects.map(row => ({type:'project',id:row.id,name:row.title})),
      ...comparisons.map(row => ({type:'comparison',id:row.id,name:row.name || row.title})),
    ].map(cleanTarget).filter(Boolean).filter((item, index, all) =>
      all.findIndex(other => other.type === item.type && other.id === item.id) === index);
    const requested = params.get('judgment');
    const current = requested ? notes.find(note => note.id === requested) : null;
    if (requested && !current) notice.textContent = '此浏览器上找不到该判断。';
    show(current);
  }

  const layout = el('div', '', 'investor-judgment-layout');
  layout.append(list, editor, related);
  root.replaceChildren(notice, layout);
  start();
})();
