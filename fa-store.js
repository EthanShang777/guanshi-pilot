/* Browser-only FA project records. Public master data and private project data never share a write path. */
const faStore = (() => {
  'use strict';

  const database = 'guanshi-pilot-fa-v1';
  const format = 'guanshi-fa-backup';
  const statuses = Object.freeze(['待联系', '已联系', '有回应', '暂缓', '不适配']);
  const entityTypes = new Set(['institution', 'fund']);
  const researchKinds = new Set(['watch', 'comparison', 'judgment', 'draft']);
  const projectFields = ['companyId', 'companyName', 'title', 'stage', 'amount', 'currency', 'ticket',
    'region', 'keywords', 'notes', 'sector', 'sub'];
  const feedbackFields = ['userReason', 'concerns', 'nextAction', 'feedback', 'status'];
  const listeners = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(database) : null;
  let connection;
  if (channel) channel.onmessage = event => notify(event.data, false);

  function fault(code, message) {
    return Object.assign(new Error(message), {code});
  }

  const invalid = (message = '项目数据格式无效。') => fault('invalid', message);
  const now = () => new Date().toISOString();
  const projectId = value => /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value || '');
  const publicId = value => /^[a-f\d]{24}$/.test(value || '');
  const object = value => value !== null && Object.prototype.toString.call(value) === '[object Object]';
  const text = value => {
    if (value == null) return '';
    if (typeof value !== 'string') throw invalid();
    return value;
  };
  const unique = list => [...new Set(list)];
  const date = value => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw invalid('日期格式无效。');
    return new Date(value).toISOString();
  };

  function data(value, depth = 0) {
    if (depth > 16) throw invalid('项目条件的结构过深。');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))) return value;
    if (Array.isArray(value)) return value.map(entry => data(entry, depth + 1));
    if (!object(value)) throw invalid();
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw invalid();
      return [key, data(entry, depth + 1)];
    }));
  }

  function conditions(value) {
    if (!object(value)) throw invalid('筛选条件格式无效。');
    return data(value);
  }

  function same(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((entry, i) => same(entry, b[i]));
    if (!object(a) || !object(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
  }

  function publishedRecord(href) {
    try {
      const url = new URL(href, location.href);
      const root = new URL('.', location.href);
      const onSite = url.pathname.startsWith(root.pathname) && url.origin === root.origin;
      const onCanonicalSite = url.origin === 'https://ethanshang777.github.io' && url.pathname.startsWith('/guanshi-pilot/');
      if ((!onSite && !onCanonicalSite) || url.username || url.password) return null;
      const kind = /^(institution|company|deal|company-research)\.html$/.exec(url.pathname.split('/').pop())?.[1];
      const id = url.searchParams.get('id');
      if (!kind || !publicId(id)) return null;
      return {kind, id, href:kind+'.html?id='+id};
    } catch { return null; }
  }

  function source(value) {
    try {
      const url = new URL(typeof value === 'string' ? value : value?.url);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch { /* Preserve only actionable public sources. */ }
    return '';
  }

  function evidence(values = []) {
    if (!Array.isArray(values)) throw invalid('案例格式无效。');
    return values.map(entry => {
      if (!object(entry)) throw invalid('案例格式无效。');
      const published = publishedRecord(text(entry.href));
      const id = text(entry.id) || published?.id || '';
      if (id && !publicId(id)) throw invalid('案例编号无效。');
      if (published && (published.kind !== 'deal' || published.id !== id)) throw invalid('案例链接与编号不一致。');
      const links = entry.sources ?? [];
      const parties = entry.parties ?? [];
      if (!Array.isArray(links) || !Array.isArray(parties)) throw invalid('案例来源格式无效。');
      return {
        id, title:text(entry.title), date:text(entry.date), href:id ? 'deal.html?id='+id : '',
        sources:unique(links.map(source).filter(Boolean)),
        companyId:text(entry.companyId), stage:text(entry.stage), dateKind:text(entry.dateKind),
        sector:text(entry.sector), sub:text(entry.sub),
        parties:unique(parties.map(text).filter(Boolean)), fundId:text(entry.fundId), fundName:text(entry.fundName),
      };
    });
  }

  function funds(values = []) {
    if (!Array.isArray(values)) throw invalid('关联基金格式无效。');
    const byId = new Map();
    for (const entry of values) {
      if (!object(entry) || !publicId(entry.id) || !text(entry.name).trim()) throw invalid('关联基金身份无效。');
      byId.set(entry.id, {id:entry.id, name:entry.name, href:'institution.html?id='+entry.id, source:source(entry.source)});
    }
    return [...byId.values()];
  }

  function projectInfo(input) {
    if (!object(input)) throw invalid();
    const info = Object.fromEntries(projectFields.map(key => [key, text(input[key]).trim()]));
    if (!info.title || !info.companyName || !publicId(info.companyId)) throw invalid('请选择公司并填写项目名称或融资目标。');
    return info;
  }

  function candidateInfo(input) {
    if (!object(input) || !entityTypes.has(input.entityType) || !publicId(input.entityId) ||
        !text(input.name).trim()) throw invalid('候选机构身份无效。');
    const fields = Object.fromEntries(feedbackFields.map(key => [key, text(input[key])]));
    fields.status ||= '待联系';
    if (!statuses.includes(fields.status)) throw invalid('候选状态无效。');
    return {
      entityType:input.entityType, entityId:input.entityId, name:input.name.trim(),
      href:'institution.html?id='+input.entityId, systemReason:text(input.systemReason),
      ...fields, evidence:evidence(input.evidence), funds:funds(input.funds),
      selection:conditions(input.selection ?? {}),
    };
  }

  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(fault('storage', '当前浏览器无法使用项目存储。'));
      const request = indexedDB.open(database, 2);
      request.onupgradeneeded = event => {
        const db = request.result;
        if (event.oldVersion < 1) {
          db.createObjectStore('projects', {keyPath:'id'});
          const records = db.createObjectStore('candidates', {keyPath:['projectId', 'entityType', 'entityId']});
          records.createIndex('project', 'projectId');
          db.createObjectStore('pending', {keyPath:'key'});
        }
        const research = db.createObjectStore('research', {keyPath:['kind','id']});
        research.createIndex('kind','kind');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        db.onclose = () => { connection = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(fault('storage', '请关闭其他观势标签页后重试打开项目。'));
    }).catch(error => {
      connection = undefined;
      throw error;
    });
    return connection;
  }

  function value(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function storageFault(error) {
    if (!(error instanceof DOMException)) return error;
    return fault('storage', error.name === 'QuotaExceededError'
      ? '浏览器存储空间不足。请释放空间后重试。'
      : '当前浏览器的项目存储不可用。请检查站点存储权限后重试。');
  }

  async function transaction(names, mode, work) {
    let tx;
    try {
      const db = await open();
      tx = db.transaction(names, mode);
    } catch (error) {
      throw storageFault(error);
    }
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error ?? fault('storage', '项目事务中止。'));
    });
    // A request error can abort before the async work returns.
    done.catch(() => {});
    const tables = Object.fromEntries(names.map(name => [name, tx.objectStore(name)]));
    try {
      const result = await work(tables);
      await done;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* The browser may already have aborted the transaction. */ }
      await done.catch(() => {});
      throw storageFault(error);
    }
  }

  function notify(change, broadcast = true) {
    for (const listener of listeners) queueMicrotask(() => listener(change));
    if (broadcast) channel?.postMessage(change);
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  const listProjects = () => transaction(['projects'], 'readonly', async ({projects}) =>
    (await value(projects.getAll())).sort((a, b) => (b.activityAt || b.updatedAt).localeCompare(a.activityAt || a.updatedAt)));

  const getProject = id => projectId(id)
    ? transaction(['projects'], 'readonly', async ({projects}) => (await value(projects.get(id))) ?? null)
    : Promise.resolve(null);

  async function requiredProject(projects, id) {
    if (!projectId(id)) throw invalid('项目编号无效。');
    const project = await value(projects.get(id));
    if (!project) throw fault('missing', '当前设备找不到这个项目。');
    return project;
  }

  async function createProject(input) {
    const info = projectInfo(input);
    const time = now();
    const row = {id:crypto.randomUUID(), ...info, revision:1, createdAt:time, updatedAt:time,
      activityAt:time, view:{}, viewUpdatedAt:''};
    await transaction(['projects'], 'readwrite', ({projects}) => value(projects.add(row)));
    notify({kind:'project', projectId:row.id});
    return row;
  }

  function checkRevision(current, expected) {
    if (current.revision !== expected) {
      throw fault('conflict', '其他标签页已修改这条记录。请核对最新内容，当前输入可保留后重试。');
    }
  }

  function researchKey(kind, id) {
    if (!researchKinds.has(kind) || typeof id !== 'string' || !/^[A-Za-z\d][A-Za-z\d:_-]{0,127}$/.test(id)) {
      throw invalid('研究记录编号无效。');
    }
    return [kind,id];
  }

  function researchInfo(kind, input) {
    if (!object(input)) throw invalid('研究记录格式无效。');
    const [type,id] = researchKey(kind,input.id);
    const {kind:ignoredKind,createdAt,updatedAt,revision,...record} = data(input);
    return {...record,kind:type,id};
  }

  const listResearch = kind => transaction(['research'],'readonly',async ({research}) => {
    if (!researchKinds.has(kind)) throw invalid('研究记录类型无效。');
    const records = await value(research.index('kind').getAll(kind));
    return records.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  });

  const getResearch = (kind,id) => transaction(['research'],'readonly',async ({research}) =>
    (await value(research.get(researchKey(kind,id)))) ?? null);

  async function saveResearch(kind,input,expectedRevision=null) {
    const info = researchInfo(kind,input);
    const key = researchKey(kind,info.id);
    const row = await transaction(['research'],'readwrite',async ({research}) => {
      const previous = await value(research.get(key));
      checkRevision(previous ?? {revision:null},expectedRevision);
      if (previous && same(researchInfo(kind,previous),info)) return previous;
      const time = now();
      const row = {...info, createdAt:previous?.createdAt ?? time, updatedAt:time, revision:(previous?.revision ?? 0)+1};
      await value(research.put(row));
      return row;
    });
    notify({kind:'research',recordKind:kind,id:info.id});
    return row;
  }

  async function removeResearch(kind,id,expectedRevision) {
    const key = researchKey(kind,id);
    await transaction(['research'],'readwrite',async ({research}) => {
      const previous = await value(research.get(key));
      if (!previous) return;
      checkRevision(previous,expectedRevision);
      await value(research.delete(key));
    });
    notify({kind:'research',recordKind:kind,id});
  }

  async function updateProject(id, patch, expectedRevision) {
    if (!object(patch)) throw invalid();
    const row = await transaction(['projects'], 'readwrite', async ({projects}) => {
      const previous = await requiredProject(projects, id);
      checkRevision(previous, expectedRevision);
      const info = projectInfo({...previous, ...patch, companyId:previous.companyId, companyName:previous.companyName});
      if (projectFields.every(key => previous[key] === info[key])) return previous;
      const time = now();
      const updated = {...previous, ...info, revision:previous.revision+1, updatedAt:time, activityAt:time};
      await value(projects.put(updated));
      return updated;
    });
    notify({kind:'project', projectId:id});
    return row;
  }

  async function saveView(id, view) {
    const valid = conditions(view);
    return transaction(['projects'], 'readwrite', async ({projects}) => {
      const previous = await requiredProject(projects, id);
      const merged = {...previous.view, ...valid};
      if (same(previous.view, merged)) return previous;
      const updated = {...previous, view:merged, viewUpdatedAt:now()};
      await value(projects.put(updated));
      return updated;
    });
  }

  function listCandidates(id, {includeRemoved = false} = {}) {
    if (!projectId(id)) return Promise.resolve([]);
    return transaction(['candidates'], 'readonly', async ({candidates}) =>
      (await value(candidates.index('project').getAll(id)))
        .filter(row => includeRemoved || !row.removedAt)
        .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, 'zh-CN')));
  }

  const candidateKey = (id, type, entityId) => [id, type, entityId];

  async function writeCandidate(tables, project, info) {
    const {projects, candidates} = tables;
    const key = candidateKey(project.id, info.entityType, info.entityId);
    const existing = await value(candidates.get(key));
    if (existing) return existing;
    const time = now();
    const row = {projectId:project.id, ...info, revision:1, addedAt:time, updatedAt:time,
      statusUpdatedAt:time, feedbackUpdatedAt:info.feedback ? time : '', removedAt:'', priorEvidence:[], evidenceUpdatedAt:time};
    await value(candidates.add(row));
    await value(projects.put({...project, activityAt:time}));
    return row;
  }

  async function saveCandidate(id, input) {
    const info = candidateInfo(input);
    const row = await transaction(['projects', 'candidates'], 'readwrite', async tables =>
      writeCandidate(tables, await requiredProject(tables.projects, id), info));
    notify({kind:'candidate', projectId:id});
    return row;
  }

  async function editCandidate(id, type, entityId, change) {
    if (!entityTypes.has(type) || !publicId(entityId)) throw invalid('候选机构身份无效。');
    const updated = await transaction(['projects', 'candidates'], 'readwrite', async ({projects, candidates}) => {
      const project = await requiredProject(projects, id);
      const previous = await value(candidates.get(candidateKey(id, type, entityId)));
      if (!previous) throw fault('missing', '找不到这个项目中的候选。');
      const time = now();
      const patch = change(previous, time);
      if (!patch) return previous;
      const next = {...previous, ...patch, updatedAt:time, revision:previous.revision+1};
      await value(candidates.put(next));
      await value(projects.put({...project, activityAt:time}));
      return next;
    });
    notify({kind:'candidate', projectId:id});
    return updated;
  }

  function revisedEvidence(previous, nextEvidence, nextFunds, time) {
    return {
      evidence:nextEvidence, funds:nextFunds, evidenceUpdatedAt:time,
      priorEvidence:[...previous.priorEvidence, {
        evidence:previous.evidence, funds:previous.funds, observedAt:previous.evidenceUpdatedAt || previous.addedAt,
      }],
    };
  }

  function updateCandidate(id, type, entityId, patch, expectedRevision) {
    if (!object(patch)) return Promise.reject(invalid());
    return editCandidate(id, type, entityId, (previous, time) => {
      checkRevision(previous, expectedRevision);
      const changed = {};
      for (const field of feedbackFields) {
        if (!Object.hasOwn(patch, field)) continue;
        const next = text(patch[field]);
        if (field === 'status' && !statuses.includes(next)) throw invalid('候选状态无效。');
        if (previous[field] !== next) changed[field] = next;
      }
      if (Object.hasOwn(changed, 'status')) changed.statusUpdatedAt = time;
      if (Object.hasOwn(changed, 'feedback')) changed.feedbackUpdatedAt = time;
      if (Object.hasOwn(changed, 'nextAction')) changed.nextActionUpdatedAt = time;
      const nextEvidence = Object.hasOwn(patch, 'evidence') ? evidence(patch.evidence) : previous.evidence;
      const nextFunds = Object.hasOwn(patch, 'funds') ? funds(patch.funds) : previous.funds;
      if (!same(previous.evidence, nextEvidence) || !same(previous.funds, nextFunds)) {
        Object.assign(changed, revisedEvidence(previous, nextEvidence, nextFunds, time));
      }
      return Object.keys(changed).length ? changed : null;
    });
  }

  const removeCandidate = (id, type, entityId) => editCandidate(id, type, entityId,
    (row, time) => row.removedAt ? null : {removedAt:time});
  const restoreCandidate = (id, type, entityId) => editCandidate(id, type, entityId,
    row => row.removedAt ? {removedAt:''} : null);

  async function pendingKey(record, name, rawHref) {
    if (record) return 'legacy:'+record.kind+':'+record.id;
    const bytes = new TextEncoder().encode(JSON.stringify([name, rawHref]));
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return 'legacy:raw:'+Array.from(hash, byte => byte.toString(16).padStart(2,'0')).join('');
  }

  async function captureLegacy() {
    let incoming;
    try { incoming = JSON.parse(sessionStorage.getItem('guanshi-shortlist') || '[]'); }
    catch { throw fault('storage', '读取旧清单失败。当前设备上的原记录仍可恢复。'); }
    if (!Array.isArray(incoming)) throw invalid('旧清单的内容格式无效。');
    const rows = await Promise.all(incoming.filter(object).map(async item => {
      const rawHref = text(item.href);
      const name = text(item.name) || rawHref || '未命名旧记录';
      const record = publishedRecord(rawHref);
      return {key:await pendingKey(record, name, rawHref), name, rawHref, reason:text(item.reason),
        href:record?.href || '', entityType:record?.kind || '', entityId:record?.id || '',
        capturedAt:now(), assignedAt:'', projectId:''};
    }));
    if (!rows.length) return {added:0};
    const added = await transaction(['pending'], 'readwrite', async ({pending}) => {
      let count = 0;
      for (const row of rows) {
        if (await value(pending.get(row.key))) continue;
        await value(pending.add(row));
        count++;
      }
      return count;
    });
    if (added) notify({kind:'pending'});
    return {added};
  }

  const listPending = () => transaction(['pending'], 'readonly', async ({pending}) =>
    (await value(pending.getAll())).filter(row => !row.assignedAt));

  async function assignPending(id, key, input) {
    const info = candidateInfo(input);
    const result = await transaction(['projects', 'candidates', 'pending'], 'readwrite', async tables => {
      const project = await requiredProject(tables.projects, id);
      const previous = await value(tables.pending.get(key));
      if (!previous || previous.assignedAt) throw fault('conflict', '这条旧记录已处理。请刷新后核对。');
      if (previous.entityType === 'company' || previous.entityType === 'company-research') {
        throw invalid('公司旧收藏保留在待归属记录中。请选择已识别的投资机构加入。');
      }
      let row = await writeCandidate(tables, project, {
        ...info, systemReason:info.systemReason || previous.reason,
      });
      const missingFunds = info.funds.filter(fund => !row.funds.some(saved => saved.id === fund.id));
      const time = now();
      if (row.removedAt || missingFunds.length) {
        const extra = missingFunds.length ? revisedEvidence(row, row.evidence, [...row.funds, ...missingFunds], time) : {};
        row = {...row, ...extra, removedAt:'', revision:row.revision+1, updatedAt:time};
        await value(tables.candidates.put(row));
        await value(tables.projects.put({...project, activityAt:time}));
      }
      await value(tables.pending.put({...previous, projectId:id, assignedAt:time}));
      return row;
    });
    notify({kind:'pending', projectId:id});
    return result;
  }

  async function exportBackup({includePrivate = true} = {}) {
    return transaction(['projects', 'candidates', 'pending', 'research'], 'readonly', async ({projects, candidates, pending, research}) => {
      const [allProjects, allCandidates, pendingRecords, researchRecords] = await Promise.all([
        value(projects.getAll()), value(candidates.getAll()), value(pending.getAll()), includePrivate ? value(research.getAll()) : [],
      ]);
      return {format, version:1, exportedAt:now(), includesPrivate:includePrivate,
        projects:includePrivate ? allProjects : allProjects.map(row => ({...row, notes:''})),
        candidates:includePrivate ? allCandidates : allCandidates.map(row => ({...row, feedback:''})),
        pending:pendingRecords, research:researchRecords};
    });
  }

  const revision = value => {
    if (!Number.isSafeInteger(value) || value < 1) throw invalid('版本编号无效。');
    return value;
  };

  function decodeBackup(input) {
    let backup = input;
    if (typeof input === 'string') {
      try { backup = JSON.parse(input.replace(/^\uFEFF/, '')); }
      catch { throw invalid('请导入观势项目的 JSON 备份。'); }
    }
    if (!object(backup) || backup.format !== format || backup.version !== 1 ||
        !Array.isArray(backup.projects) || !Array.isArray(backup.candidates) || !Array.isArray(backup.pending)) {
      throw invalid('请导入受支持的观势项目 JSON 备份。');
    }
    const projectKeys = new Set();
    const candidateKeys = new Set();
    const pendingKeys = new Set();
    const projects = backup.projects.map(row => {
      if (!object(row) || !projectId(row.id) || projectKeys.has(row.id)) throw invalid('项目编号无效或重复。');
      projectKeys.add(row.id);
      return {id:row.id, ...projectInfo(row), revision:revision(row.revision),
        createdAt:date(row.createdAt), updatedAt:date(row.updatedAt), activityAt:date(row.activityAt || row.updatedAt),
        view:conditions(row.view ?? {}), viewUpdatedAt:row.viewUpdatedAt ? date(row.viewUpdatedAt) : ''};
    });
    const candidates = backup.candidates.map(row => {
      if (!object(row) || !projectKeys.has(row.projectId)) throw invalid('候选缺少所属项目。');
      const info = candidateInfo(row);
      const key = candidateKey(row.projectId, info.entityType, info.entityId).join('|');
      if (candidateKeys.has(key)) throw invalid('备份中存在重复的候选身份。');
      candidateKeys.add(key);
      if (row.priorEvidence != null && !Array.isArray(row.priorEvidence)) throw invalid('原始案例快照格式无效。');
      return {projectId:row.projectId, ...info, revision:revision(row.revision),
        addedAt:date(row.addedAt), updatedAt:date(row.updatedAt),
        statusUpdatedAt:date(row.statusUpdatedAt || row.updatedAt), feedbackUpdatedAt:row.feedbackUpdatedAt ? date(row.feedbackUpdatedAt) : '',
        ...(row.nextActionUpdatedAt ? {nextActionUpdatedAt:date(row.nextActionUpdatedAt)} : {}),
        removedAt:row.removedAt ? date(row.removedAt) : '', evidenceUpdatedAt:date(row.evidenceUpdatedAt || row.addedAt),
        priorEvidence:(row.priorEvidence ?? []).map(item => {
          if (!object(item)) throw invalid('原始案例快照格式无效。');
          return {evidence:evidence(item.evidence), funds:funds(item.funds), observedAt:date(item.observedAt)};
        })};
    });
    const pending = backup.pending.map(row => {
      if (!object(row) || !/^legacy:(?:(?:company|company-research|institution|deal):[a-f\d]{24}|raw:[a-f\d]{64})$/.test(row.key)
          || pendingKeys.has(row.key) || (row.assignedAt && !projectKeys.has(row.projectId))) {
        throw invalid('旧清单的归属或编号无效。');
      }
      pendingKeys.add(row.key);
      const record = publishedRecord(text(row.href));
      const matches = record ? row.key === 'legacy:'+record.kind+':'+record.id : row.key.startsWith('legacy:raw:');
      if (!matches) throw invalid('旧清单的链接与编号不一致。');
      return {key:row.key, name:text(row.name), rawHref:text(row.rawHref), reason:text(row.reason),
        href:record?.href || '', entityType:record?.kind || '', entityId:record?.id || '',
        capturedAt:date(row.capturedAt), assignedAt:row.assignedAt ? date(row.assignedAt) : '',
        projectId:row.assignedAt ? row.projectId : ''};
    });
    if (backup.research != null && !Array.isArray(backup.research)) throw invalid('研究备份格式无效。');
    const researchKeys = new Set();
    const research = (backup.research ?? []).map(row => {
      const info = researchInfo(row?.kind,row);
      const key = researchKey(info.kind,info.id).join('|');
      if (researchKeys.has(key)) throw invalid('研究备份中存在重复编号。');
      researchKeys.add(key);
      return {...info, revision:revision(row.revision), createdAt:date(row.createdAt), updatedAt:date(row.updatedAt)};
    });
    return {projects, candidates, pending, research};
  }

  async function importBackup(input, {asCopy = false} = {}) {
    const backup = decodeBackup(input);
    const result = {projects:0, candidates:0, pending:0, research:0, conflicts:0};
    const ids = new Map();
    if (asCopy) {
      for (const project of backup.projects) {
        const id = crypto.randomUUID();
        ids.set(project.id, id);
        project.id = id;
        project.title += '（恢复副本）';
        project.activityAt = now();
      }
      for (const row of backup.candidates) row.projectId = ids.get(row.projectId);
      for (const row of backup.pending) if (row.projectId) row.projectId = ids.get(row.projectId);
      const comparisonIds = new Map();
      for (const row of backup.research) {
        if (row.kind === 'comparison') comparisonIds.set(row.id,crypto.randomUUID());
      }
      for (const row of backup.research) {
        if (row.kind === 'comparison') row.id = comparisonIds.get(row.id);
        if (row.kind === 'judgment') row.id = crypto.randomUUID();
        if (row.projectId && ids.has(row.projectId)) row.projectId = ids.get(row.projectId);
        if (Array.isArray(row.targets)) row.targets = row.targets.map(target => {
          const id = target?.type === 'project' ? ids.get(target.id) :
            target?.type === 'comparison' ? comparisonIds.get(target.id) : '';
          return id ? {...target,id,href:''} : target;
        });
      }
    }
    await transaction(['projects', 'candidates', 'pending', 'research'], 'readwrite', async tables => {
      const companyConflicts = new Set();
      for (const name of Object.keys(backup)) {
        for (const row of backup[name]) {
          if (companyConflicts.has(row.projectId)) continue;
          const key = name === 'projects' ? row.id :
            name === 'candidates' ? candidateKey(row.projectId, row.entityType, row.entityId) :
              name === 'research' ? researchKey(row.kind,row.id) : row.key;
          const current = await value(tables[name].get(key));
          if (name === 'projects' && current && current.companyId !== row.companyId) {
            companyConflicts.add(row.id);
          }
          if (!current) {
            await value(tables[name].add(row));
            result[name]++;
          } else if (!same(current, row)) {
            // Assigned legacy tombstones win over unaffiliated copies of the same entry.
            if (name === 'pending' && !current.assignedAt && row.assignedAt) {
              await value(tables.pending.put(row));
            } else if (name !== 'pending' || Boolean(current.assignedAt) !== Boolean(row.assignedAt)) {
              result.conflicts++;
            }
          }
        }
      }
    });
    notify({kind:'import'});
    return result;
  }

  function exportedRows(project, candidates, {includePrivate = false} = {}) {
    const header = ['项目', '公司', '目标轮次', '机构', '机构链接', '候选类型', '关联基金', '基金依据', '系统依据', '用户理由',
      '案例', '来源日期', '来源链接', '待核实', '状态', '下一步', '加入时间', '最近更新'];
    if (includePrivate) header.push('私有反馈');
    const href = value => value ? new URL(value, location.href).href : '';
    const rows = candidates.filter(c => !c.removedAt).map(c => {
      const row = [
        project.title, project.companyName, project.stage, c.name, href(c.href),
        c.entityType === 'fund' ? '基金' : '机构',
        c.funds.map(fund => fund.name).join('\n'), unique(c.funds.map(fund => fund.source).filter(Boolean)).join('\n'),
        c.systemReason, c.userReason,
        c.evidence.map(item => item.title).join('\n'), unique(c.evidence.map(item => item.date)).join('\n'),
        unique(c.evidence.flatMap(item => item.sources.length ? item.sources : [href(item.href)]).filter(Boolean)).join('\n'),
        c.concerns, c.status, c.nextAction, c.addedAt, c.updatedAt,
      ];
      if (includePrivate) row.push(c.feedback);
      return row;
    });
    return [header, ...rows];
  }

  function delimited(rows, delimiter) {
    return rows.map(row => row.map(value => {
      const cell = String(value ?? '');
      // Quoting preserves line breaks. Leading spreadsheet formulas need an explicit text marker.
      const safe = /^(?:\s*[=+@-]|[\t\r\n])/.test(cell) ? "'"+cell : cell;
      return '"'+safe.replaceAll('"', '""')+'"';
    }).join(delimiter)).join('\r\n');
  }

  return Object.freeze({
    statuses, subscribe, listProjects, getProject, createProject, updateProject, saveView,
    listResearch, getResearch, saveResearch, removeResearch,
    listCandidates, saveCandidate, updateCandidate, removeCandidate, restoreCandidate,
    captureLegacy, listPending, assignPending, exportBackup, importBackup,
    csv:(project, candidates, options) => '\uFEFF'+delimited(exportedRows(project, candidates, options), ','),
    clipboard:(project, candidates, options) => delimited(exportedRows(project, candidates, options), '\t'),
  });
})();
