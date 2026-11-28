(() => {
  const root = document.querySelector('#fa-projects');
  if (!root) return;

  const panel = root.querySelector('#fa-project-content');
  const pageStatus = root.querySelector('#fa-page-status');
  const heading = root.closest('main').querySelector('.hero h1');
  if (heading) heading.id = 'fa-project-title';
  const args = new URLSearchParams(location.search);
  const statuses = ['待联系', '已联系', '有回应', '暂缓', '不适配'];
  const publicIdPattern = /^[a-f0-9]{24}$/;
  const publicFiles = new Map();
  let legacyReadError = '';
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {dateStyle: 'short', timeStyle: 'short'});
  const projectFields = [
    ['title', '项目名称或融资目标'], ['stage', '目标轮次'], ['amount', '拟募总额'],
    ['currency', '币种'], ['ticket', '期望单家票面'], ['region', '地域或落地要求'],
    ['keywords', '业务关键词'], ['notes', '项目备注'],
  ];
  const candidateFields = [
    ['status', '推进状态'], ['userReason', '我的入选理由'], ['concerns', '需核实的问题'],
    ['feedback', '私有反馈'], ['nextAction', '下一步动作'],
  ];

  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  function link(text, href, cls) {
    const a = el('a', text, cls);
    a.href = href;
    return a;
  }
  function button(text, action, primary = false) {
    const b = el('button', text, primary ? 'fa-primary' : '');
    b.type = 'button';
    b.onclick = action;
    return b;
  }
  function status() {
    const p = el('p', null, 'fa-status');
    p.setAttribute('role', 'status');
    return p;
  }
  function message(p, text, state = '') {
    p.textContent = text;
    p.dataset.state = state;
  }
  function route(page, params = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, value]) => value));
    return page + (q.size ? '?' + q : '');
  }
  const savedUrl = project => route('projects.html', {project: project.id, tab: 'saved'});
  const matchUrl = project => route('workspace.html', {project: project.id});
  const companyUrl = (id, project) => route('company.html', {id, project: project?.id, from: project ? 'saved' : ''});
  function setTitle(text) {
    if (heading) heading.textContent = text;
    document.title = '我的项目 · 观势';
  }
  function date(value, fallback = '日期未列明') {
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(+parsed) ? dateFormat.format(parsed) : fallback;
  }
  function external(value) {
    try {
      const url = new URL(value);
      return /^(?:https?):$/.test(url.protocol) && !url.username && !url.password ? url : null;
    } catch { return null; }
  }
  function sourceUrls(values) {
    return [...new Set((values || []).map(value => external(value)?.href).filter(Boolean))];
  }
  function sourceLink(value, title) {
    const url = external(value);
    if (!url) return null;
    const a = link(title || url.hostname + ' 原文', url.href, 'fa-source-link');
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }
  function recordId(href, kind) {
    try {
      const url = new URL(href, location.href);
      const id = url.searchParams.get('id') || '';
      if (url.origin === location.origin && url.pathname.endsWith('/' + kind + '.html') && publicIdPattern.test(id)) return id;
    } catch {}
    return '';
  }
  async function lookup(kind, id, visited = new Set()) {
    if (!publicIdPattern.test(id || '') || visited.has(id) || visited.size >= 4) throw Error('原档案编号无效');
    visited.add(id);
    const key = kind + '-' + id.slice(0, 2);
    if (!publicFiles.has(key)) {
      const task = fetch('records/' + key + '.json', {cache: 'no-cache'}).then(response => {
        if (!response.ok) throw Error('公开资料暂时不可读取');
        return response.json();
      }).catch(error => { publicFiles.delete(key); throw error; });
      publicFiles.set(key, task);
    }
    const record = (await publicFiles.get(key))[id];
    if (!record) throw Error('公开档案中没有这条记录');
    if (record.redirect) return lookup(kind, record.redirect, visited);
    return {record, id};
  }
  function breadcrumb(items) {
    const nav = el('nav', null, 'fa-breadcrumb');
    nav.setAttribute('aria-label', '当前位置');
    items.forEach(([text, href], i) => {
      if (i) nav.append(' / ');
      nav.append(href ? link(text, href) : el('span', text));
    });
    return nav;
  }
  function control(key, labelText, value, options = {}) {
    const label = el('label', labelText, options.wide ? 'fa-wide' : '');
    let input;
    if (options.choices) {
      input = el('select');
      for (const value of options.choices) input.add(new Option(value || '留空', value));
    } else if (options.multiline) {
      input = el('textarea');
      input.rows = options.rows || 2;
    } else {
      input = el('input');
      input.type = 'text';
    }
    input.name = key;
    input.value = value || '';
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.required) input.required = true;
    if (options.maxLength) input.maxLength = options.maxLength;
    label.append(input);
    return label;
  }
  function projectControl(key, label, value) {
    return control(key, label, value, {
      wide: key === 'notes' || key === 'title',
      multiline: key === 'notes',
      required: key === 'title',
      maxLength: key === 'notes' ? 2000 : 160,
      placeholder: ({title: '例如 2026 年 A 轮融资', amount: '例如 8,000 万', ticket: '例如 1,000–2,000 万', currency: '例如 人民币'})[key],
    });
  }
  function buttonLink(text, url, primary = false) {
    return link(text, url, 'fa-button' + (primary ? ' fa-primary' : ''));
  }
  function safeFile(text) {
    return text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 60) || '观势';
  }
  function download(data, filename, type) {
    const url = URL.createObjectURL(new Blob([data], {type}));
    const a = link('', url);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function attachEditor({form, fields, record, save, refresh, onSaved}) {
    const rail = el('div', null, 'fa-form-actions');
    const saveButton = el('button', '保存', 'fa-primary');
    saveButton.type = 'submit';
    const result = status();
    const notice = el('div', null, 'fa-edit-notice');
    rail.append(saveButton, result);
    form.append(rail, notice);
    let current = record;
    const inputField = key => form.elements.namedItem(key);
    const draftPatch = () => Object.fromEntries(fields
      .map(([key]) => [key, inputField(key).value.trim()])
      .filter(([key, v]) => v !== (current[key] || '')));
    form.onsubmit = async event => {
      event.preventDefault();
      const patch = draftPatch();
      if (!Object.keys(patch).length) {
        message(result, '已保存');
        notice.replaceChildren();
        return;
      }
      saveButton.disabled = true;
      message(result, '正在保存…');
      try {
        const saved = await save(patch, current.revision);
        current = saved;
        message(result, '已保存 · ' + date(saved.updatedAt));
        notice.replaceChildren();
        onSaved?.(saved);
      } catch (error) {
        if (error.code !== 'conflict') {
          message(result, '保存失败。输入已保留，可再次保存。', 'error');
        } else {
          message(result, '另一处已更新，当前输入已保留。', 'error');
          const note = el('p', '读取新版后会保留你修改过的字段，可以核对两处输入后再次保存。');
          const reload = button('读取新版并保留输入', async () => {
            reload.disabled = true;
            try {
              const draft = draftPatch();
              const latest = await refresh();
              if (!latest || latest.removedAt) throw Error('条目已移出或不可用');
              const changes = el('ul');
              for (const [key, label] of fields) {
                if (!Object.hasOwn(draft, key)) inputField(key).value = latest[key] || '';
                else if ((latest[key] || '') !== (current[key] || '') && (latest[key] || '') !== draft[key]) {
                  changes.append(el('li', label + ' · 当前已存 ' + (latest[key] || '空白') + ' / 你的输入 ' + (draft[key] || '空白')));
                }
              }
              current = latest;
              onSaved?.(latest);
              message(result, '已读取新版，请核对后保存。');
              notice.replaceChildren(...(changes.children.length ? [changes] : []));
            } catch {
              message(result, '暂时无法读取新版。输入已保留，可重试读取。', 'error');
              reload.disabled = false;
            }
          });
          notice.replaceChildren(note, reload);
        }
      } finally {
        saveButton.disabled = false;
      }
    };
    return latest => { current = latest; };
  }

  function createForm(company, id) {
    const wrap = el('section');
    wrap.append(el('h2', '新建融资项目'));
    const source = el('p', null, 'fa-muted');
    source.append(link(company.name, companyUrl(id)));
    for (const item of [company.primary !== '待归类' && company.primary, company.sub].filter(Boolean)) source.append(' · ' + item);
    wrap.append(source);
    const financing = (company.events || []).find(event => event[2] && !['股权转让', '介绍上市', '拟增资'].includes(event[2]));
    if (financing) wrap.append(el('p', '最近收录融资 ' + [financing[1], financing[2], financing[3]].filter(Boolean).join(' · '), 'fa-muted'));
    const form = el('form', null, 'fa-form');
    const name = projectControl(...projectFields[0], '');
    form.append(name);
    const more = el('details', null, 'fa-editor');
    const grid = el('div', null, 'fa-grid-form');
    for (const [key, label] of projectFields.slice(1)) grid.append(projectControl(key, label, ''));
    more.append(el('summary', '补充本轮条件'), grid);
    form.append(more);
    const actions = el('div', null, 'fa-form-actions');
    const submit = el('button', '建立项目并找投资方', 'fa-primary');
    const result = status();
    submit.type = 'submit';
    actions.append(submit, result);
    form.append(actions);
    form.onsubmit = async event => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      message(result, '正在保存…');
      try {
        const input = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
        const project = await faStore.createProject({
          ...input, companyId: id, companyName: company.name,
          sector: company.primary === '待归类' ? '' : (company.primary || ''), sub: company.sub || '',
        });
        message(result, '已保存');
        location.assign(matchUrl(project));
      } catch (error) {
        message(result, error.code === 'invalid' ? error.message : '保存失败。填写内容已保留，可再次保存。', 'error');
        submit.disabled = false;
      }
    };
    wrap.append(form);
    return wrap;
  }

  async function nextSummary(project) {
    const candidates = await faStore.listCandidates(project.id);
    const prioritized = [...candidates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const actionable = prioritized.filter(item => item.nextAction && item.status !== '不适配');
    const next = actionable.find(item => item.status !== '暂缓') || actionable[0];
    return {count: candidates.length, next, updated: [project.activityAt || project.updatedAt, project.viewUpdatedAt].filter(Boolean).sort().at(-1)};
  }
  async function projectList(projects) {
    const list = el('ul', null, 'fa-list');
    const statistics = await Promise.all(projects.map(nextSummary));
    const sorted = projects.map((project, i) => [project, statistics[i]])
      .sort(([,a], [,b]) => (b.updated || '').localeCompare(a.updated || ''));
    for (const [project, {count, next, updated}] of sorted) {
      const li = el('li', null, 'fa-project-row');
      const main = el('div');
      main.append(link(project.title, savedUrl(project)), el('small', [project.companyName, project.stage || '轮次待补'].join(' · ')));
      const meta = el('div');
      meta.append(el('span', count + ' 家已选'), el('small', date(updated)));
      const task = el('div', null, 'fa-next');
      task.append(el('small', '下一步'), el('span', next ? next.name + ' · ' + next.nextAction : (count ? '查看清单，补充下一步' : '查找资方')));
      const actions = el('div', null, 'fa-toolbar');
      actions.append(buttonLink('继续筛选', matchUrl(project)), buttonLink('查看清单', savedUrl(project)));
      li.append(main, meta, task, actions);
      list.append(li);
    }
    return list;
  }

  function backupSection() {
    const details = el('details', null, 'fa-shelf');
    details.append(el('summary', '备份与恢复'), el('p', 'JSON 备份可在其他设备导入。包含私有内容的文件应自行妥善保管。', 'fa-muted'));
    const bar = el('div', null, 'fa-toolbar');
    const check = el('input');
    check.type = 'checkbox';
    const label = el('label', null, 'fa-check');
    label.append(check, '备份包含私有备注和反馈');
    const result = status();
    const exportButton = button('下载 JSON 备份', async () => {
      exportButton.disabled = true;
      message(result, '正在读取…');
      try {
        const data = await faStore.exportBackup({includePrivate: check.checked});
        download(JSON.stringify(data, null, 2) + '\n', '观势项目备份-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json;charset=utf-8');
        message(result, '备份已就绪');
      } catch {
        message(result, '读取失败，可重试。', 'error');
      } finally { exportButton.disabled = false; }
    });
    const picker = el('input');
    picker.type = 'file';
    picker.accept = '.json,application/json';
    picker.hidden = true;
    let value;
    const importButton = button('导入备份', async () => {
      if (!value) return;
      await importSelected(false);
    });
    const asCopy = button('另存为新项目', async () => {
      if (!value) return;
      await importSelected(true);
    });
    async function importSelected(copy) {
      importButton.disabled = asCopy.disabled = true;
      message(result, '正在恢复…');
      try {
        const changes = await faStore.importBackup(value, {asCopy: copy});
        message(result, [changes.projects + ' 个项目', changes.candidates + ' 条候选', changes.pending + ' 条待归属记录'].join(' · ') +
          '已导入' + (changes.conflicts ? '。现有记录保留，' + changes.conflicts + ' 处冲突可另存为新项目。' : '。'));
        const current = panel.querySelector('.fa-list');
        const all = await faStore.listProjects();
        if (current && all.length) current.replaceWith(await projectList(all));
        else if (all.length) {
          const empty = panel.querySelector('.fa-project-empty');
          if (empty) empty.replaceWith(await projectList(all));
        }
        const pending = panel.querySelector('#fa-pending-entries');
        const updated = await pendingSection(all);
        if (pending) {
          if (updated) pending.replaceWith(updated); else pending.remove();
        } else if (updated) panel.append(updated);
        asCopy.hidden = !changes.conflicts;
      } catch (error) {
        message(result, error.message || '无法导入这份备份，可重新选择文件。', 'error');
      } finally { importButton.disabled = asCopy.disabled = false; }
    }
    importButton.hidden = asCopy.hidden = true;
    picker.onchange = async () => {
      value = undefined;
      importButton.hidden = asCopy.hidden = true;
      const file = picker.files[0];
      picker.value = '';
      if (!file) return;
      try {
        value = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
        importButton.hidden = false;
        message(result, '已选 ' + file.name + '。导入会合并数据并保留冲突的现有记录。');
      } catch {
        message(result, '无法读取 JSON，请选择观势备份文件。', 'error');
      }
    };
    bar.append(label, exportButton, button('选择备份文件', () => picker.click()), picker, importButton, asCopy);
    details.append(bar, result);
    return details;
  }

  async function pendingSection(projects) {
    const items = await faStore.listPending();
    if (!items.length) return null;
    const list = el('ul', null, 'fa-pending');
    const details = el('details', null, 'fa-shelf');
    details.id = 'fa-pending-entries';
    details.append(el('summary', '旧清单待归属 · ' + items.length + ' 项'));
    for (const item of items) {
      const li = el('li', item.name);
      li.append(el('p', item.reason || '旧记录无入选理由', 'fa-muted'));
      if (!publicIdPattern.test(item.entityId || '') || !['institution', 'fund'].includes(item.entityType)) {
        li.append(el('small', '缺少可核对的机构身份，原记录已保留。'));
      } else if (!projects.length) {
        li.append(el('small', '建立项目后可手动归入。'));
      } else {
        const form = el('form', null, 'fa-toolbar');
        const select = el('select');
        select.setAttribute('aria-label', '归属融资项目');
        select.add(new Option('选择项目', ''));
        select.required = true;
        for (const p of projects) select.add(new Option(p.title + ' · ' + p.companyName, p.id));
        const move = el('button', '归入项目');
        const result = status();
        move.type = 'submit';
        form.append(select, move, result);
        form.onsubmit = async event => {
          event.preventDefault();
          move.disabled = true;
          message(result, '核对机构身份并保存…');
          try {
            const {id,record} = await lookup('institution', item.entityId);
            if (record.evidenceOnly) throw Error('原档案为未具名或待识别记录');
            const index = await faNavigation.loadFunds();
            const candidate = await faNavigation.resolveInvestor(id, record.name, index);
            await faStore.assignPending(select.value, item.key, {
              ...candidate, systemReason: item.reason || '', concerns: '旧清单迁入，入选时的来源未记录。',
            });
            const visible = panel.querySelector('.fa-list');
            if (visible) visible.replaceWith(await projectList(projects));
            li.remove();
            if (!list.children.length) details.remove();
            else details.querySelector('summary').textContent = '旧清单待归属 · ' + list.children.length + ' 项';
          } catch (error) {
            message(result, (error.message || '保存失败') + '。原记录已保留。', 'error');
            move.disabled = false;
          }
        };
        li.append(form);
      }
      list.append(li);
    }
    details.append(list);
    return details;
  }

  async function home() {
    const projects = await faStore.listProjects();
    const companyId = args.get('company');
    if (companyId) {
      if (!publicIdPattern.test(companyId)) throw Error('公司链接无效');
      const {id, record: company} = await lookup('company', companyId);
      const related = projects.filter(project => project.companyId === id);
      setTitle(company.name);
      panel.append(breadcrumb([['我的项目', 'projects.html'], ['公司档案', companyUrl(id)]]));
      if (args.get('new') === '1' || !related.length) panel.append(createForm(company, id));
      else {
        const row = el('div', null, 'fa-list-label');
        row.append(el('h2', '已有融资项目'), buttonLink('创建新项目', route('projects.html', {company:id, new:'1'}), true));
        panel.append(row, await projectList(related));
      }
      return;
    }
    setTitle('我的项目');
    const actions = el('div', null, 'fa-toolbar');
    actions.append(buttonLink('选择公司并建立项目', 'companies.html', true));
    panel.append(el('p', '项目保存在当前设备的这个浏览器。', 'fa-muted'), actions);
    if (projects.length) panel.append(await projectList(projects));
    else {
      const empty = el('div', null, 'fa-empty fa-project-empty');
      empty.append(el('p', '选择一家已收录的公司，在档案中建立融资项目。'));
      panel.append(empty);
    }
    panel.append(backupSection());
    if (legacyReadError) panel.append(el('p', legacyReadError + '。旧数据已保留，可刷新后重试。', 'fa-muted'));
    const pending = await pendingSection(projects);
    if (pending) panel.append(pending);
  }

  function goalSummary(project) {
    const list = el('dl', null, 'fa-goals');
    const entries = [
      ['目标轮次', project.stage || '待补'], ['拟募总额', project.amount || '待补'],
      ['币种', project.currency || '待补'], ['期望单家票面', project.ticket || '待补'],
      ['地域或落地', project.region], ['业务关键词', project.keywords],
    ];
    for (const [label, text] of entries) {
      if (!text) continue;
      const group = el('div');
      group.append(el('dt', label), el('dd', text));
      list.append(group);
    }
    return list;
  }
  function dealLink(evidence, project, candidate) {
    const id = evidence.id || recordId(evidence.href, 'deal');
    return publicIdPattern.test(id || '') ? route('deal.html', {id, project:project.id, from:'saved', candidate:candidate.entityId}) : '';
  }
  function institutionLink(candidate, project, id = candidate.entityId) {
    return route('institution.html', {id, project:project.id, from:'saved', candidate:candidate.entityId});
  }
  function evidenceList(items, project, candidate) {
    const list = el('ol', null, 'fa-source-list');
    for (const row of items) {
      const li = el('li');
      const href = dealLink(row, project, candidate);
      li.append(href ? link(row.title || '查看交易', href) : el('span', row.title || '交易'));
      li.append(el('small', [row.date || '披露日期未列明', row.dateKind, row.stage, row.sub || row.sector].filter(Boolean).join(' · ')));
      for (const url of row.sources || []) {
        const a = sourceLink(url);
        if (a) li.append(a);
      }
      list.append(li);
    }
    return list;
  }
  function fundList(items, project, candidate) {
    const list = el('ul', null, 'fa-source-list');
    for (const fund of items) {
      const li = el('li');
      if (publicIdPattern.test(fund.id || '')) li.append(link(fund.name, institutionLink(candidate, project, fund.id)));
      else li.append(el('span', fund.name));
      const source = sourceLink(fund.source, '管理关系原文');
      if (source) li.append(' ', source);
      list.append(li);
    }
    return list;
  }
  function selectionText(item) {
    const selection = item.selection?.filters || item.selection || {};
    const keys = [['sector', '赛道'], ['sub', '细分'], ['stage', '轮次'], ['year', '年份'],
      ['investor', '资方搜索'], ['company', '公司搜索']];
    return keys.filter(([key]) => !!selection[key]).map(([key, label]) => label + ' ' + selection[key]).join(' · ');
  }
  async function compareEvidence(items) {
    const changes = [];
    let unavailable = 0;
    const evidence = [];
    for (const saved of items) {
      const oldId = saved.id || recordId(saved.href, 'deal');
      if (!publicIdPattern.test(oldId || '')) {
        evidence.push(saved);
        continue;
      }
      try {
        const {id, record} = await lookup('deal', oldId);
        const after = {
          ...saved, id, href: route('deal.html', {id}), title:record.company || saved.title,
          date:record.day || '', sources:sourceUrls(record.sources),
        };
        for (const [key, value] of [['stage',record.stage],['sector',record.sector],['sub',record.sub],['dateKind',record.dateKind]]) {
          if (Object.hasOwn(saved, key)) after[key] = value || '';
        }
        if (Array.isArray(saved.parties)) after.parties = (record.parties || []).map(([name]) => name);
        const labels = [];
        if (after.id !== oldId) labels.push('档案已归并');
        if (after.title !== saved.title) labels.push('公司名称已更新为 ' + after.title);
        if (after.date !== (saved.date || '')) labels.push('披露日期由 ' + (saved.date || '未列明') + ' 变为 ' + (after.date || '未列明'));
        if (Object.hasOwn(saved, 'stage') && after.stage !== saved.stage) labels.push('轮次已更新为 ' + (after.stage || '未列明'));
        if (Object.hasOwn(saved, 'dateKind') && after.dateKind !== saved.dateKind) labels.push('日期口径有更新');
        const classificationChanged = ['sector','sub'].some(key => Object.hasOwn(saved, key) && after[key] !== saved[key]);
        if (classificationChanged) labels.push('分类有更新');
        if (Array.isArray(saved.parties) && !sameSet(saved.parties, after.parties)) labels.push('披露参与方有更新');
        if (!sameSet(sourceUrls(saved.sources), after.sources)) labels.push('来源有更新');
        if (labels.length) changes.push({row:after, labels});
        evidence.push(labels.length ? after : saved);
      } catch {
        unavailable += 1;
        evidence.push(saved);
      }
    }
    return {changes, unavailable, evidence};
  }
  function sameSet(a, b) {
    return a.length === b.length && a.every(item => b.includes(item));
  }

  function outputTools(project, notify) {
    const details = el('details', null, 'fa-shelf');
    details.append(el('summary', '复制或导出清单'));
    details.append(el('p', '包含项目、机构、入选理由、案例及来源、需核实的问题、状态和下一步。私有反馈可另外包含。', 'fa-muted'));
    const rail = el('div', null, 'fa-toolbar');
    const label = el('label', null, 'fa-check');
    const privateInput = el('input');
    privateInput.type = 'checkbox';
    label.append(privateInput, '包含私有反馈');
    const fallback = el('textarea', null, 'fa-copy-field');
    fallback.hidden = true;
    fallback.readOnly = true;
    fallback.rows = 5;
    fallback.setAttribute('aria-label', '待手动复制的名单');
    const copy = button('复制名单', async () => {
      copy.disabled = true;
      try {
        const items = await faStore.listCandidates(project.id);
        if (!items.length) { message(notify, '项目清单为空。'); return; }
        const latest = await faStore.getProject(project.id);
        const text = faStore.clipboard(latest, items, {includePrivate:privateInput.checked});
        try {
          await navigator.clipboard.writeText(text);
          fallback.hidden = true;
          message(notify, '已复制 ' + items.length + ' 条候选。');
        } catch {
          fallback.hidden = false;
          fallback.value = text;
          fallback.focus();
          fallback.select();
          message(notify, '可在下方手动复制。');
        }
      } catch {
        message(notify, '读取清单失败，可重试。', 'error');
      } finally { copy.disabled = false; }
    });
    const exportButton = button('导出 CSV', async () => {
      exportButton.disabled = true;
      try {
        const items = await faStore.listCandidates(project.id);
        if (!items.length) { message(notify, '项目清单为空。'); return; }
        const latest = await faStore.getProject(project.id);
        const data = faStore.csv(latest, items, {includePrivate:privateInput.checked});
        download(data.startsWith('\uFEFF') ? data : '\uFEFF' + data, safeFile(latest.title) + '-候选清单.csv', 'text/csv;charset=utf-8');
        message(notify, '已准备 ' + items.length + ' 条候选的 CSV。');
      } catch {
        message(notify, '导出失败，可重试。', 'error');
      } finally { exportButton.disabled = false; }
    });
    rail.append(label, copy, exportButton);
    details.append(rail, fallback);
    return details;
  }

  function candidateBlock(project, entry, move) {
    let current = entry;
    let checkNumber = 0;
    const row = el('details', null, 'fa-candidate');
    row.id = 'candidate-' + current.entityId;
    const summary = el('summary');
    const headline = el('span');
    const entity = el('span', entry.name);
    const badge = el('span', entry.status);
    const last = el('small', null, 'fa-last');
    const changeLabel = el('small', null, 'fa-change-label');
    headline.append(entity, badge, last);
    summary.append(headline);
    const body = el('div', null, 'fa-candidate-body');
    const first = el('section');
    const reason = el('p', entry.systemReason || '入选时未记录系统理由。', 'fa-private-note');
    const savedEvidence = el('div');
    const differences = el('div', null, 'fa-evidence-updates');
    differences.setAttribute('aria-live', 'polite');
    const facts = el('p', null, 'fa-muted');
    const attr = el('details');
    attr.append(el('summary', '入选时的条件'), el('p', selectionText(entry) || '入选时未记录检索条件。'));
    const preview = el('div', null, 'fa-toolbar');
    preview.append(buttonLink('查看机构档案', institutionLink(entry, project)));
    first.append(el('h3', '系统入选理由'), reason, facts, savedEvidence, differences, attr, preview);
    const second = el('section');
    const edit = el('form', null, 'fa-form fa-candidate-form');
    for (const [key, label] of candidateFields) {
      edit.append(control(key, label, entry[key], {
        choices: key === 'status' ? statuses : undefined,
        multiline: ['userReason', 'concerns', 'feedback'].includes(key),
        maxLength: 2000,
      }));
    }
    if (entry.systemReason) {
      preview.prepend(button('编辑入选理由', () => {
        const input = edit.elements.namedItem('userReason');
        if (!input.value.trim()) input.value = entry.systemReason;
        input.focus();
      }));
    }
    const acceptRecord = attachEditor({
      form:edit, fields:candidateFields, record:entry,
      save:(patch, revision) => faStore.updateCandidate(project.id, entry.entityType, entry.entityId, patch, revision),
      refresh:async () => (await faStore.listCandidates(project.id,{includeRemoved:true})).find(item => item.entityType===entry.entityType && item.entityId===entry.entityId),
      onSaved:record => {
        current = record;
        move(record, false);
        meta();
      },
    });
    const stamps = el('p', null, 'fa-muted fa-feedback-stamps');
    const removalStatus = status();
    const remove = button('移出清单', async () => {
      remove.disabled = true;
      message(removalStatus, '正在保存…');
      try {
        const updated = await faStore.removeCandidate(project.id, entry.entityType, entry.entityId);
        move(updated, true, true);
      } catch {
        message(removalStatus, '移出失败，候选仍保留，可重试。', 'error');
        remove.disabled = false;
      }
    });
    remove.classList.add('fa-remove');
    second.append(el('h3', '推进记录'), edit, stamps, remove, removalStatus);
    const feedback = button('记录反馈', () => edit.elements.namedItem('feedback').focus());
    feedback.classList.add('fa-feedback-jump');
    body.append(feedback, first, second);
    row.append(summary, body);

    function meta() {
      badge.textContent = current.status;
      last.textContent = current.nextAction ? '下一步 ' + current.nextAction : '更新于 ' + date(current.updatedAt);
      if (changeLabel.textContent) last.append(changeLabel);
      facts.textContent = '入选 ' + date(current.addedAt) + ' · 更新 ' + date(current.updatedAt);
      stamps.textContent = [
        current.statusUpdatedAt && '状态更新 ' + date(current.statusUpdatedAt),
        current.feedbackUpdatedAt && '反馈更新 ' + date(current.feedbackUpdatedAt),
      ].filter(Boolean).join(' · ');
    }
    function paintEvidence() {
      savedEvidence.replaceChildren(el('h3', '项目已保存的依据'));
      if (current.evidence?.length) savedEvidence.append(evidenceList(current.evidence, project, current));
      else savedEvidence.append(el('p', '暂无可追溯的入选案例。', 'fa-muted'));
      if (current.funds?.length) savedEvidence.append(el('h3', '关联基金'), fundList(current.funds, project, current));
      if (current.priorEvidence?.length) {
        const history = el('details');
        history.append(el('summary', '查看此前证据快照 · ' + current.priorEvidence.length + ' 次'));
        for (const old of [...current.priorEvidence].reverse()) {
          history.append(el('p', '保留于 ' + date(old.observedAt)));
          if (old.evidence?.length) history.append(evidenceList(old.evidence, project, current));
          if (old.funds?.length) history.append(fundList(old.funds, project, current));
        }
        savedEvidence.append(history);
      }
    }
    async function checkPublic() {
      const ticket = ++checkNumber;
      const source = current.evidence || [];
      if (!source.length) return;
      differences.setAttribute('aria-busy', 'true');
      const observed = await compareEvidence(source);
      if (ticket !== checkNumber || !row.isConnected) return;
      differences.setAttribute('aria-busy', 'false');
      differences.replaceChildren();
      changeLabel.textContent = observed.changes.length ? ' · 公开资料有变化' : '';
      meta();
      if (observed.unavailable) differences.append(el('p',
        observed.unavailable + ' 条案例暂时无法回查，原快照已保留。', 'fa-muted'));
      if (!observed.changes.length) return;
      differences.append(el('h3', '当前公开资料变化'));
      const labels = el('ul', null, 'fa-source-list');
      for (const item of observed.changes) {
        const li = el('li');
        li.append(link(item.row.title, dealLink(item.row, project, current)), el('small', item.labels.join(' · ')));
        for (const url of item.row.sources || []) {
          const a = sourceLink(url);
          if (a) li.append(a);
        }
        labels.append(li);
      }
      const updateStatus = status();
      const update = button('采用当前证据', async () => {
        update.disabled = true;
        message(updateStatus, '正在保存…');
        try {
          current = await faStore.updateCandidate(project.id, entry.entityType, entry.entityId, {evidence:observed.evidence}, current.revision);
          acceptRecord(current);
          move(current, false);
          changeLabel.textContent = '';
          meta();
          paintEvidence();
          differences.replaceChildren(el('p', '已保存更新，旧快照可回查。'));
        } catch (error) {
          message(updateStatus, error.code === 'conflict' ? '记录已在另一处更新，请核对后刷新清单再试。' : '保存失败，可重试。', 'error');
          update.disabled = false;
        }
      });
      differences.append(labels, update, updateStatus);
    }
    meta();
    paintEvidence();
    return {row, checkPublic};
  }

  async function projectPage(project) {
    setTitle(project.title);
    const records = await faStore.listCandidates(project.id, {includeRemoved:true});
    const current = new Map(records.map(item => [item.entityType + ':' + item.entityId, item]));
    const parts = new Map();
    const batches = [];
    let initializing = true;
    const intro = el('div', null, 'fa-project-intro');
    const introData = el('div');
    const actions = el('div', null, 'fa-toolbar');
    const selected = el('span', null, 'fa-muted');
    selected.setAttribute('aria-live', 'polite');
    introData.append(breadcrumb([['我的项目','projects.html'],[project.companyName,companyUrl(project.companyId, project)]]));
    const goals = goalSummary(project);
    const notes = el('p', project.notes, 'fa-private-note');
    notes.hidden = !project.notes;
    introData.append(goals, notes);
    actions.append(buttonLink('继续找投资方', matchUrl(project), true), selected);
    intro.append(introData, actions);
    panel.append(intro);
    const editor = el('details', null, 'fa-editor');
    editor.append(el('summary', '编辑项目目标'));
    const form = el('form', null, 'fa-form');
    const fields = el('div', null, 'fa-grid-form');
    for (const [key, label] of projectFields) fields.append(projectControl(key, label, project[key]));
    form.append(fields);
    attachEditor({
      form,fields:projectFields,record:project,
      save:(patch, revision)=>faStore.updateProject(project.id,patch,revision),
      refresh:()=>faStore.getProject(project.id),
      onSaved:saved=>{
        setTitle(saved.title);
        goals.replaceChildren(...goalSummary(saved).childNodes);
        notes.textContent = saved.notes;
        notes.hidden = !saved.notes;
      },
    });
    editor.append(form);
    panel.append(editor);
    const notify = status();
    const label = el('h2', '项目清单');
    label.id = 'fa-candidates-title';
    const shelf = el('section');
    shelf.setAttribute('aria-labelledby', label.id);
    const list = el('div', null, 'fa-candidates');
    const empty = el('div', null, 'fa-empty');
    empty.append(el('p', '这个项目还没有候选。'), buttonLink('前往候选结果', matchUrl(project), true));
    const archived = el('details', null, 'fa-shelf');
    const archiveList = el('ul', null, 'fa-archived');
    const archiveSummary = el('summary', '已移出');
    archived.append(archiveSummary, archiveList);
    const tools = outputTools(project, notify);
    shelf.append(label, notify, list, empty, tools, archived);
    panel.append(shelf);

    function counts() {
      const active = [...current.values()].filter(item=>!item.removedAt);
      selected.textContent = '已选 ' + active.length + ' 家';
      empty.hidden = active.length > 0;
      list.hidden = active.length === 0;
      tools.hidden = active.length === 0;
      archiveSummary.textContent = '已移出 · ' + archiveList.children.length + ' 家';
      archived.hidden = !archiveList.children.length;
    }
    async function restore(item, trigger) {
      trigger.disabled = true;
      message(notify, '正在恢复…');
      try {
        const updated = await faStore.restoreCandidate(project.id, item.entityType, item.entityId);
        move(updated, true);
        message(notify, item.name + '已恢复');
        const restored = parts.get(updated.entityType + ':' + updated.entityId);
        if (location.hash === '#' + restored.id) restored.open = true;
        restored.querySelector('summary')?.focus();
      } catch {
        message(notify, '恢复失败，可重试。', 'error');
        trigger.disabled = false;
      }
    }
    function move(record, redraw, announce = false) {
      const id = record.entityType + ':' + record.entityId;
      current.set(id, record);
      if (redraw) {
        parts.get(id)?.remove();
        if (record.removedAt) {
          const item = el('li');
          const name = el('span', record.name);
          name.append(el('small', ' · ' + date(record.removedAt)));
          const resume = button('恢复', () => restore(record, resume));
          item.append(name, resume);
          parts.set(id, item);
          archiveList.append(item);
          if (announce) {
            const undo = button('撤销移出', () => restore(record, undo));
            notify.replaceChildren(document.createTextNode('已移出 ' + record.name + '　'), undo);
            undo.focus();
          }
        } else {
          const candidate = candidateBlock(project, record, move);
          parts.set(id, candidate.row);
          list.append(candidate.row);
          if (initializing) batches.push(candidate.checkPublic);
          else candidate.checkPublic();
        }
      }
      if (!initializing) counts();
    }
    for (const record of records) move(record, true);
    counts();
    initializing = false;
    let cursor = 0;
    async function compareBatch() {
      while (cursor < batches.length) await batches[cursor++]();
    }
    for (let i = 0; i < Math.min(4, batches.length); i++) compareBatch();
    function openRequestedCandidate() {
      const requested = location.hash.slice(1);
      const anchor = /^candidate-[a-f0-9]{24}$/.test(requested) ? document.getElementById(requested) : null;
      if (!anchor) return;
      anchor.open = true;
      requestAnimationFrame(() => anchor.scrollIntoView({block:'start'}));
    }
    window.addEventListener('hashchange', openRequestedCandidate);
    openRequestedCandidate();
  }

  async function main() {
    try {
      try { await faStore.captureLegacy(); }
      catch { legacyReadError = '旧清单暂时无法读取'; }
      const id = args.get('project');
      if (id) {
        const project = await faStore.getProject(id);
        if (!project) {
          panel.append(el('p','这个浏览器没有该项目。可前往我的项目，或导入该项目的备份。'),
            buttonLink('前往我的项目','projects.html',true));
        } else await projectPage(project);
      } else await home();
      pageStatus.hidden = true;
    } catch (error) {
      message(pageStatus, (error.message || '本机项目暂时无法读取') + '。请检查浏览器存储权限或重试。', 'error');
      panel.append(button('重新读取', () => location.reload()));
    }
  }
  main();
})();
