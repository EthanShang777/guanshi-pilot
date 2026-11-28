/* Compare public company records using the private research store for work in progress. */
const investorCompare = (() => {
  'use strict';

  const draftId = 'active-comparison';
  const maximum = 5;
  const publicId = /^[0-9a-f]{24}$/;
  const savedId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const nonFinancing = new Set(['股权转让', '介绍上市', '拟增资']);
  const fields = [
    ['business', '业务与目标客户', '公开材料所述业务和目标使用场景'],
    ['technology', '产品与技术路线', '公开产品说明、技术资料及其验证边界'],
    ['commercial', '商业化进展', '合作、采用、付费和收入各按来源原口径记载'],
    ['difference', '差异化判断', '有来源的档案研究判断，保留各自适用条件'],
    ['financing', '最近融资', '按已收录融资档案排序。币种、日期类型和金额口径可能不同，须分别核对。'],
    ['investors', '历史资方', '已收录融资中的具名资方，按档案身份去重'],
    ['questions', '主要研究疑问', '研究档案已有的问题和证据缺口'],
    ['coverage', '资料时间与来源', '研究档案标注日期与最近融资档案日期分列'],
  ];
  const defaultFields = fields.map(([id]) => id);
  const notesLimit = 4000;
  const nameLimit = 100;
  const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
  const qs = (selector, root = document) => root.querySelector(selector);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const command = (label, run, className = 'cmp-button') => {
    const button = make('button', className, label);
    button.type = 'button';
    button.addEventListener('click', run);
    return button;
  };
  const hrefFor = id => 'company.html?id=' + id;
  const safeLink = value => {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, location.href);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  };
  const link = (href, label, className) => {
    const a = make('a', className, label);
    a.href = safeLink(href);
    return a;
  };
  const idFromHref = (href, kind) => {
    try {
      const url = new URL(href, location.href);
      const id = url.searchParams.get('id');
      if (url.origin === location.origin && url.pathname === new URL(kind + '.html', location.href).pathname && publicId.test(id)) return id;
    } catch { /* The indexes may include legacy records. */ }
    return '';
  };
  const cache = new Map();
  function records(stem) {
    if (!cache.has(stem)) cache.set(stem, fetch('records/' + stem + '.json').then(response => {
      if (!response.ok) throw new Error('档案分片读取失败');
      return response.json();
    }).catch(error => {
      cache.delete(stem);
      throw error;
    }));
    return cache.get(stem);
  }

  async function entity(kind, id, seen = new Set()) {
    if (!publicId.test(id) || seen.has(id) || seen.size >= 8) throw new Error('档案身份无法解析');
    const row = (await records(kind + '-' + id.slice(0, 2)))[id];
    if (!row) return null;
    if (!row.redirect) return {id, row};
    seen.add(id);
    return entity(kind, row.redirect, seen);
  }

  function selection(values) {
    const unique = new Map();
    for (const value of Array.isArray(values) ? values : []) {
      if (value && publicId.test(value.id) && typeof value.name === 'string' && !unique.has(value.id)) {
        unique.set(value.id, {id:value.id, name:value.name.trim() || '公司档案'});
      }
    }
    return [...unique.values()].slice(0, maximum);
  }

  const store = () => (typeof faStore === 'undefined' ? null : faStore);
  let currentDraft;
  let draftFlight;
  let draftQueue = Promise.resolve();
  let draftListening = false;
  let draftError = '';
  const listeners = new Set();

  function publishDraft(record) {
    currentDraft = record ?? {id:draftId, companies:[]};
    draftError = '';
    for (const listener of listeners) listener();
    syncButtons();
  }

  function listenToDraft() {
    if (draftListening) return;
    draftListening = true;
    store()?.subscribe(change => {
      if (change?.kind === 'import' || change?.kind === 'research' && change.recordKind === 'draft') {
        refreshDraft().catch(() => {});
      }
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted) refreshDraft().catch(() => {});
    });
  }

  async function refreshDraft() {
    listenToDraft();
    if (draftFlight) return draftFlight;
    draftFlight = (async () => {
      try {
        if (!store()?.getResearch) throw new Error('当前浏览器的比较存储不可用。');
        const draft = await store().getResearch('draft', draftId);
        publishDraft(draft);
        return currentDraft;
      } catch (error) {
        draftError = message(error, '当前浏览器的比较存储不可用。');
        for (const listener of listeners) listener();
        throw error;
      }
    })().finally(() => { draftFlight = null; });
    return draftFlight;
  }

  function message(error, fallback) {
    return typeof error?.message === 'string' && /[\u3400-\u9fff]/.test(error.message) ? error.message : fallback;
  }

  function updateDraft(update) {
    const write = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const previous = await refreshDraft();
        const fields = update(previous);
        if (!fields) return previous;
        const {revision, updatedAt, ...input} = previous;
        try {
          const next = await store().saveResearch('draft', {...input, ...fields, id:draftId}, revision);
          publishDraft(next);
          return next;
        } catch (error) {
          if (error.code !== 'conflict' || attempt === 1) throw error;
          // Another page updated the same draft. Apply the operation to the newest copy.
        }
      }
    };
    const result = draftQueue.then(write);
    draftQueue = result.catch(() => {});
    return result;
  }

  function changeDraftCompany(company, remove) {
    return updateDraft(previous => {
      const companies = selection(previous.companies);
      const existing = companies.some(item => item.id === company.id);
      if (remove) return existing ? {companies:companies.filter(item => item.id !== company.id)} : null;
      if (existing) return null;
      if (companies.length >= maximum) throw new Error('已选 5 家公司，移除一家后可以继续添加。');
      return {companies:[...companies, company]};
    });
  }

  function syncButtons() {
    const companies = selection(currentDraft?.companies);
    const ids = new Set(companies.map(company => company.id));
    document.querySelectorAll('[data-investor-compare-company]').forEach(button => {
      const selected = ids.has(button.dataset.investorCompareCompany);
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = selected ? '已加入比较' : '加入比较';
    });
  }

  function button(value, name) {
    const id = publicId.test(value) ? value : idFromHref(value, 'company');
    if (!id) return document.createDocumentFragment();
    const company = selection([{id, name}])[0];
    if (!company) return document.createDocumentFragment();
    const selected = selection(currentDraft?.companies).some(item => item.id === id);
    const node = command(selected ? '已加入比较' : '加入比较', async () => {
      node.disabled = true;
      try { await changeDraftCompany(company, node.getAttribute('aria-pressed') === 'true'); }
      catch (error) {
        draftError = message(error, '保存选择失败，请重试。');
        for (const listener of listeners) listener();
      } finally { node.disabled = false; }
    }, 'cmp-button cmp-quick');
    node.dataset.investorCompareCompany = id;
    node.setAttribute('aria-pressed', String(selected));
    node.setAttribute('aria-label', '比较 · ' + company.name);
    if (!currentDraft && !draftFlight) refreshDraft().catch(() => {});
    return node;
  }

  function mountTray(host) {
    if (!host) return;
    const bar = make('section', 'cmp-tray');
    bar.setAttribute('aria-label', '公司比较选择');
    const count = make('span', 'cmp-tray-count');
    count.setAttribute('role', 'status');
    const chips = make('ul', 'cmp-tray-names');
    const open = link('compare.html', '打开比较', 'cmp-button cmp-main');
    const notice = make('p', 'cmp-tray-notice');
    notice.setAttribute('role', 'status');
    bar.append(count, chips, open, notice);
    const draw = () => {
      const companies = selection(currentDraft?.companies);
      const focusedId = chips.contains(document.activeElement) ? document.activeElement.dataset.id : '';
      count.textContent = companies.length ? '已选 ' + companies.length + ' 家' : '比较公司';
      chips.replaceChildren(...companies.map(company => {
        const item = make('li');
        const remove = command('×', () => changeDraftCompany(company, true).catch(error => {
          draftError = message(error, '移除失败，请重试。');
          draw();
        }), 'cmp-chip-remove');
        remove.dataset.id = company.id;
        remove.setAttribute('aria-label', '移除 ' + company.name);
        item.append(make('span', '', company.name), remove);
        return item;
      }));
      open.hidden = !companies.length;
      notice.hidden = !draftError;
      notice.textContent = draftError;
      bar.hidden = !companies.length && !draftError;
      const restore = focusedId && (qs('[data-id="' + focusedId + '"]', chips) || (companies.length ? open : host));
      if (restore?.focus) restore.focus();
    };
    listeners.add(draw);
    host.insertAdjacentElement('afterend', bar);
    draw();
    if (!currentDraft && !draftFlight) refreshDraft().catch(() => {});
  }

  function uniqueSources(sources) {
    const unique = new Map();
    for (const value of sources.filter(Boolean)) {
      const source = typeof value === 'string' ? {url:value} : value;
      const url = safeLink(source.url);
      if (!url || unique.has(url)) continue;
      unique.set(url, {url, title:source.title || new URL(url).hostname, date:source.date || ''});
    }
    return [...unique.values()];
  }

  // Only passages with explicit attribution are used as evidence of business progress.
  // Keep the complete archive claim and every limitation available in the evidence drawer.
  const position = /^(?:公司(?:开发|定位|提供|主营|聚焦|面向)|官方企业页(?:区分|列出|介绍)|[^。；]{0,28}(?:官网|官方文档)(?:将|列|展示|描述|介绍|定位)|[^。；]{1,24}(?:为[^。；]{2,36}提供|面向[^。；]{2,30}(?:提供|打造)))/u;
  const technical = /(?:技术论文|技术发布|模型卡|技术预览|产品文档|技术白皮书|发布说明|部署框架|官方仓库|技术报告|产品规格|官方产品页|论文v\d)/u;
  const commercial = /(?:公告|报道|新闻稿|财报|披露|原稿)[^。；]{0,45}(?:签署|达成|中标|已用于|已交付|已上线|已在|已部署|完成试点|实现收入|营业收入|业务收入|付费客户|实际回款)|(?:已用于|已部署|已交付)[^。；]{1,30}(?:客户|产线|项目)|官方[^。；]{0,35}(?:仍为预订|正式交付|公开试用)/u;
  const judgment = /^(?:投资判断|投资核验|核心尽调|下一步应|应把|应分开)|^(?=.{0,175}(?:对标|形成分层对照|的价值命题|的投资价值应|更可能来自|壁垒|差异化))(?!(?:官网|官方|公告|报道))/u;
  const publishedVerbs = /^(?:公司|官网|官方|作者|厂商|第三方|合作方)|(?:官方|产品手册|论文|研究团队|技术团队|项目团队|发布说明|技术报告|技术预览)/u;

  function claimCell(claim, text, label) {
    return {
      lines:[{text, label}],
      sources:claim.sources,
      detail:[...(text === claim.text ? [] : [claim.text]), ...(claim.limits || [])],
    };
  }

  const unknown = (status = '未收录', detail = []) => ({status, lines:[], sources:[], detail});
  const sentenceParts = text => text.match(/[^。！？]+[。！？]?/gu) || [];
  const firstSentence = text => sentenceParts(text)[0] || text;
  const internal = (href, title) => ({url:href, title});
  const archiveSource = company => internal(hrefFor(company.id), '观势 · ' + company.name + ' 公司档案');

  function profileCells(company) {
    const row = company.row;
    const profile = row.profile;
    const claims = (profile?.claims || []).filter(claim => claim.text && uniqueSources(claim.sources || []).length);
    const unclassified = claims.filter(claim => !judgment.test(claim.text));
    const business = unclassified.find(claim => position.test(claim.text));
    const route = unclassified.find(claim => technical.test(claim.sources.map(source => source.title).join(' '))
        && !/^(?:应|需|优先|还需|能力上限|当前仅)/u.test(claim.text)) ||
      unclassified.find(claim => /(?:技术路线|支持.*(?:部署|训练)|部署框架|部署方式|自托管|研发平台|产品架构|模型用于|模型推理|视触觉传感器)/u.test(claim.text)
        && (publishedVerbs.test(claim.text) || position.test(claim.text)));
    const progress = unclassified.map(claim => {
      const qualifying = sentenceParts(claim.text).find(line => commercial.test(line) &&
        !/^(?:应|需|下一步|不能|优先|待|未|缺少|已核公告存在)/u.test(line.trim()));
      return {claim, qualifying};
    }).find(entry => entry.qualifying);
    const compare = claims.find(claim => judgment.test(claim.text));
    const limits = [...new Set(claims.flatMap(claim => claim.limits || []))];
    let questions = unknown();
    if (profile?.question || limits.length) {
      questions = {
        status:'待核实',
        lines:profile.question ? [{text:profile.question}] : [],
        sources:[archiveSource(company), ...claims.flatMap(claim => claim.sources)],
        detail:limits,
      };
    }
    const businessText = business && firstSentence(business.text).split(/[，；](?:支持|列出)/u)[0];
    const routeSentence = route && firstSentence(route.text);
    const routeText = routeSentence && (
      routeSentence.match(/(?:[，；](?:支持|列出)|产品页描述)([^。；]+?)(?=，同时|[。；]|$)/u)?.[1] ||
      routeSentence.match(/^公司开发用于[^。；]+?的([^。；]+)[。；]$/u)?.[1] ||
      routeSentence);
    const progressText = progress?.qualifying.match(/仍为预订[^。；]*[。；]?/u)?.[0] || progress?.qualifying;
    return {
      business:business ? claimCell(business, businessText) :
        unknown('未收录', row.sub ? ['已归入「' + row.sub + '」。业务和客户仍须查证。'] : []),
      technology:route ? claimCell(route, routeText) : unknown(),
      commercial:progress ? claimCell(progress.claim, progressText) :
        unknown(limits.some(limit => /收入|转化|付费|合同|续费|回款|商业|验收/u.test(limit)) ? '待核实' : '未收录',
          limits.filter(limit => /收入|转化|付费|合同|续费|回款|商业|验收/u.test(limit))),
      difference:compare ? claimCell(compare, firstSentence(compare.text), '档案研究判断') : unknown(),
      questions,
    };
  }

  function investorHistory(events) {
    const parties = new Map();
    for (const [href, , , , investors] of events) {
      for (const [name, target] of investors || []) {
        const identity = idFromHref(target, 'institution') || name;
        if (!parties.has(identity)) parties.set(identity, {name, href:target, deal:href});
      }
    }
    return [...parties.values()];
  }

  function financingCells(company) {
    const {row, deal, dealState} = company;
    const events = (row.events || []).filter(event => !nonFinancing.has(event[2]));
    const first = events[0];
    const parties = investorHistory(events);
    let financing = unknown();
    const latestLinks = first ? [
      internal(first[0], '观势 · 融资记录'),
      ...(deal?.sources || first[5] || []),
    ] : [];
    const missingDate = '事件或披露日期未收录';
    const date = deal?.day || first?.[1];
    const dateKind = deal?.dateKind;
    const dateLabel = date ? [dateKind && !['原档日期','未知'].includes(dateKind) ? dateKind : '档案日期（类型待核）', date].join(' ') : missingDate;
    if (first) {
      const rawAmount = String(deal?.amount || first[3] || '').trim();
      const explicitlyUndisclosed = /(?:单笔|本轮|该笔|融资)?金额(?:仍|尚)?未披露/u.test(dateKind || '');
      let amount = rawAmount || (explicitlyUndisclosed ? '未披露' : '未收录');
      if (/未披露|未公开|保密/u.test(rawAmount) && !/\d/.test(rawAmount)) amount = '未披露';
      if (/未列明|未记录|^[\s—–-]+$/u.test(rawAmount)) amount = '未收录';
      if (/待核|不详|不明/u.test(rawAmount) && !/\d/.test(rawAmount)) amount = '待核实';
      const currencyText = /(?:人民币|美元|欧元|港[元币]|日元|英镑|韩元|加元|澳元|新加坡元|新元|瑞[士典]|卢比|卢布|越南盾|印尼盾|林吉特|泰铢|新台币|迪拉姆|里亚尔|披索|比索|雷亚尔|\b(?:USD|CNY|RMB|EUR|HKD|GBP|JPY|KRW|INR|CAD|AUD|SGD|CHF|SEK|TWD|AED|MYR|IDR|BRL|MXN)\b)/iu.test(rawAmount);
      financing = {
        lines:[
          {text:[deal?.stage || first[2] || '轮次未收录', dateLabel].join(' · '), numeric:true},
          {text:amount, label:'该笔披露金额', numeric:true, nowrap:true},
        ],
        sources:latestLinks,
        detail:[
          ...(!currencyText && /\d|[数近约逾超][千万亿]/u.test(rawAmount) ? ['原档未明确币种，待核实。'] : []),
          ...(dealState === 'failed' ? ['交易详情暂时加载失败。日期与其他字段可到原交易复核。'] : []),
          ...(dealState === 'missing' ? ['该交易详情未收录，当前显示公司档案所载摘要。'] : []),
        ],
      };
    }
    const investorCells = parties.length ? {
      lines:[],
      parties,
      sources:events.filter(event => event[4]?.length).flatMap(event => [
        internal(event[0], '观势 · ' + [event[1], event[2]].filter(Boolean).join(' ')),
        ...(event[5] || []),
      ]),
      detail:[],
    } : unknown();
    const profile = row.profile;
    const coverage = {
      lines:[
        {text:profile?.asof || '未收录', label:'研究档案日期', numeric:true},
        {text:first ? dateLabel : '未收录', label:'最近融资日期', numeric:true},
      ],
      sources:[archiveSource(company), ...latestLinks, ...(profile?.claims || []).flatMap(claim => claim.sources || [])],
      detail:[],
    };
    return {financing, investors:investorCells, coverage};
  }

  async function loadCompany(company) {
    let record;
    try { record = await entity('company', company.id); }
    catch { return {...company, state:'failed'}; }
    if (!record) return {...company, state:'missing'};
    const {id, row} = record;
    const result = {id, row, name:row.name, state:'ready'};
    const event = (row.events || []).find(item => !nonFinancing.has(item[2]));
    const key = idFromHref(event?.[0], 'deal');
    if (key) {
      try {
        result.deal = (await entity('deal', key))?.row;
        if (!result.deal) result.dealState = 'missing';
      } catch { result.dealState = 'failed'; }
    }
    result.cells = {...profileCells(result), ...financingCells(result)};
    return result;
  }

  function companyCell(company, key) {
    if (company.state === 'loading') return unknown('正在加载');
    if (company.state === 'failed') return unknown('档案加载失败');
    if (company.state === 'missing') return unknown('未收录');
    return company.cells[key];
  }

  function createEvidence() {
    const drawer = make('dialog', 'cmp-drawer');
    drawer.setAttribute('aria-labelledby', 'cmp-evidence-title');
    const header = make('header', 'cmp-drawer-head');
    const title = make('h2');
    title.id = 'cmp-evidence-title';
    const close = command('关闭', () => drawer.close());
    const body = make('div', 'cmp-drawer-body');
    header.append(title, close);
    drawer.append(header, body);
    drawer.addEventListener('click', event => {
      if (event.target === drawer) drawer.close();
    });
    function open(company, field, cell) {
      title.textContent = company.name + ' · ' + field[1];
      body.replaceChildren(make('p', 'cmp-muted', field[2]));
      if (cell.status) body.append(make('p', 'cmp-cell-status', cell.status));
      for (const line of cell.lines) body.append(make('p', '', [line.label, line.text].filter(Boolean).join(' · ')));
      if (cell.parties) {
        const observations = make('ul', 'cmp-evidence-sources');
        for (const party of cell.parties) {
          const item = make('li');
          item.append(link(party.href, party.name), ' · ', link(party.deal, '对应融资档案'));
          observations.append(item);
        }
        body.append(observations);
      }
      for (const note of cell.detail) body.append(make('p', 'cmp-evidence-note', note));
      const citations = uniqueSources(cell.sources);
      if (citations.length) {
        const list = make('ul', 'cmp-evidence-sources');
        for (const source of citations) {
          const item = make('li');
          const sourceLink = link(source.url, source.title);
          sourceLink.target = '_blank';
          sourceLink.rel = 'noopener noreferrer';
          item.append(sourceLink);
          if (source.date) item.append(make('small', 'cmp-muted', '来源日期 ' + source.date));
          list.append(item);
        }
        body.append(make('h3', '', '来源'), list);
      }
      drawer.showModal();
      close.focus();
    }
    return {drawer, open};
  }

  function renderCell(cell, open) {
    const td = make('td');
    if (cell.status) td.append(make('p', 'cmp-cell-status', cell.status));
    for (const line of cell.lines) {
      const p = make('p', 'cmp-cell-line');
      if (line.label) p.append(make('span', 'cmp-line-label', line.label));
      p.append(make('span', [line.numeric ? 'cmp-numeric' : '', line.nowrap ? 'cmp-amount' : ''].filter(Boolean).join(' '), line.text));
      td.append(p);
    }
    if (cell.parties?.length) {
      const listed = cell.parties.slice(0, 3);
      const p = make('p', 'cmp-cell-line');
      listed.forEach((party, i) => p.append(i ? '、' : '', link(party.href, party.name)));
      td.append(p);
      if (cell.parties.length > listed.length) td.append(make('span', 'cmp-muted', '共 ' + cell.parties.length + ' 家'));
    }
    if (cell.detail[0] && (!cell.sources.length || cell.detail[0].startsWith('原档未明确币种'))) {
      td.append(make('p', 'cmp-muted', cell.detail[0]));
    }
    if (cell.sources.length || cell.detail.length || cell.parties?.length) {
      td.append(command(cell.parties ? '资方与依据' : cell.sources.length ? '查看证据' : '核查说明', open, 'cmp-text-button'));
    }
    return td;
  }

  function exportRows(companies, selectedFields) {
    const rows = [['公司','公司档案','字段','口径','状态','内容','限制与说明','来源']];
    for (const field of fields.filter(([id]) => selectedFields.includes(id))) {
      for (const company of companies) {
        const cell = companyCell(company, field[0]);
        const detail = cell.lines.map(line => [line.label, line.text].filter(Boolean).join('：'));
        if (cell.parties) detail.push(...cell.parties.map(party =>
          party.name + '（' + safeLink(party.href) + '，对应融资 ' + safeLink(party.deal) + '）'));
        rows.push([company.name, safeLink(hrefFor(company.id)), field[1], field[2], cell.status || '见来源',
          detail.join('\n'), cell.detail.join('\n'),
          uniqueSources(cell.sources).map(source => [source.title, source.date, source.url].filter(Boolean).join(' · ')).join('\n')]);
      }
    }
    return rows;
  }

  function clipboardFallback(text) {
    const input = make('textarea', 'cmp-clipboard');
    input.value = text;
    const focused = document.activeElement;
    document.body.append(input);
    input.select();
    try {
      if (!document.execCommand('copy')) throw new Error('剪贴板不可用，请使用导出 CSV。');
    } finally {
      input.remove();
      focused?.focus();
    }
  }

  async function copyRows(rows) {
    const text = rows.slice(1).map(([company, companyRecord, field, basis, status, claim, limit, evidence]) =>
      [company + '｜' + field, companyRecord, '口径 ' + basis, '状态 ' + status, claim, limit, evidence].filter(Boolean).join('\n')).join('\n\n');
    try { await navigator.clipboard.writeText(text); }
    catch { clipboardFallback(text); }
  }

  function downloadRows(rows) {
    const csvField = value => {
      const text = /^[\s\uFEFF]*[=+@-]/u.test(value) || /^[\t\r\n]/.test(value) ? "'" + value : value;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const csv = '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n');
    const href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
    const anchor = make('a');
    anchor.href = href;
    anchor.download = '观势-公司比较.csv';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  function createPicker(add) {
    const root = make('form', 'cmp-picker');
    root.setAttribute('role', 'search');
    const input = make('input', 'cmp-input');
    input.type = 'search';
    input.placeholder = '按简称或全称查找';
    input.setAttribute('aria-label', '查找公司加入比较');
    const toggle = make('button', 'cmp-button', '查找');
    toggle.type = 'submit';
    const results = make('div', 'cmp-picker-results');
    const description = make('p', 'cmp-picker-status');
    description.setAttribute('role', 'status');
    const list = make('ul');
    results.hidden = true;
    results.append(description, list);
    root.append(input, toggle, results);
    let serial = 0;
    let timer;
    function close() {
      results.hidden = true;
      serial++;
      clearTimeout(timer);
    }
    async function search() {
      const query = normalize(input.value);
      if (!query) return close();
      const request = ++serial;
      results.hidden = false;
      description.textContent = '正在查找…';
      list.replaceChildren();
      try {
        const directory = await records('company-lookup');
        if (request !== serial) return;
        const exact = [];
        const prefix = [];
        const includes = [];
        for (let i = 0; i < directory.length; i++) {
          const [name, aliases] = directory[i];
          const names = [name, ...(aliases || [])].map(normalize);
          if (names.includes(query)) exact.push(i);
          else if (prefix.length < 8 && names.some(value => value.startsWith(query))) prefix.push(i);
          else if (includes.length < 8 && names.some(value => value.includes(query))) includes.push(i);
        }
        const hits = await Promise.all([...exact, ...prefix, ...includes].slice(0, 8).map(async index => {
          const page = await records('company-summary-' + Math.floor(index / 30));
          return page[index % 30];
        }));
        if (request !== serial) return;
        description.textContent = hits.length ? '选择公司' : '没有匹配的公司';
        for (const [id, name, area, sector] of hits) {
          const item = make('li');
          const pick = command(name, async () => {
            const added = await add({id,name});
            if (added && request === serial) {
              input.value = '';
              close();
              input.focus();
            }
          }, 'cmp-picker-option');
          const info = make('small', 'cmp-muted', [area, sector].filter(Boolean).join(' · '));
          pick.append(info);
          item.append(pick);
          list.append(item);
        }
      } catch {
        if (request === serial) description.textContent = '公司索引读取失败，请重试。';
      }
    }
    input.addEventListener('input', () => {
      clearTimeout(timer);
      serial++;
      timer = setTimeout(search, 180);
    });
    root.addEventListener('submit', event => {
      event.preventDefault();
      clearTimeout(timer);
      search();
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !results.hidden) {
        event.preventDefault();
        close();
        input.focus();
      }
    });
    root.addEventListener('focusout', event => {
      if (event.relatedTarget && !root.contains(event.relatedTarget)) close();
    });
    document.addEventListener('pointerdown', event => {
      if (!root.contains(event.target)) close();
    });
    return root;
  }

  function start(root) {
    const params = new URLSearchParams(location.search);
    const requestedId = params.get('id');
    let saved;
    let ready = false;
    let companies = [];
    let display = [];
    let generation = 0;
    let selectedFields = [...defaultFields];
    let saving = false;
    let knownProjects = [];
    let metaTimer;
    const status = make('p', 'cmp-page-status');
    status.setAttribute('role', 'status');
    const feedback = (content = '') => { status.textContent = content; };

    const picker = createPicker(async company => {
      if (!ready) return false;
      if (companies.some(item => item.id === company.id)) {
        feedback(company.name + ' 已在比较中。');
        return false;
      }
      if (companies.length >= maximum) {
        feedback('已选 5 家公司，移除一家后可以继续添加。');
        return false;
      }
      return changeCompanies(items => {
        if (items.some(item => item.id === company.id)) throw new Error(company.name + ' 已在比较中。');
        if (items.length >= maximum) throw new Error('已选 5 家公司，移除一家后可以继续添加。');
        return [...items, company];
      });
    });
    const catalogLink = link('companies.html', '浏览公司档案', 'cmp-link');
    const archivesLink = link('research-companies.html', '研究档案库', 'cmp-link');
    const mainBar = make('div', 'cmp-primary-bar');
    mainBar.append(picker, catalogLink, archivesLink);

    const toolbar = make('div', 'cmp-toolbar');
    const tools = make('div', 'cmp-tools');
    const counts = make('span', 'cmp-selection-count');
    counts.setAttribute('aria-live', 'polite');
    toolbar.append(counts, tools);
    const fieldChooser = make('details', 'cmp-field-chooser');
    const fieldMenu = make('fieldset');
    fieldMenu.append(make('legend', '', '显示字段'));
    const fieldToggles = new Map();
    for (const [id, label] of fields) {
      const option = make('label');
      const check = make('input');
      check.type = 'checkbox';
      check.checked = true;
      check.addEventListener('change', () => {
        const next = defaultFields.filter(value => fieldToggles.get(value).checked);
        if (!next.length) {
          check.checked = true;
          feedback('请至少保留一个比较字段。');
          return;
        }
        selectedFields = next;
        feedback();
        queueMeta();
        drawTable();
      });
      fieldToggles.set(id, check);
      option.append(check, label);
      fieldMenu.append(option);
    }
    fieldChooser.append(make('summary', 'cmp-button', '显示字段'), fieldMenu);

    const copy = command('复制结果', async () => {
      try {
        await copyRows(exportRows(display, selectedFields));
        feedback('已复制比较结果。');
      } catch (error) { feedback(message(error, '复制失败，请使用导出 CSV。')); }
    });
    const exportButton = command('导出 CSV', () => {
      downloadRows(exportRows(display, selectedFields));
      feedback('已下载比较结果。');
    });
    const library = make('select', 'cmp-input cmp-saved-select');
    library.setAttribute('aria-label', '打开已保存的比较');
    library.add(new Option('已保存的比较', ''));
    library.addEventListener('change', () => {
      if (savedId.test(library.value)) location.assign('compare.html?id=' + library.value);
    });
    tools.append(fieldChooser, copy, exportButton, library);

    const scroll = make('div', 'cmp-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', '公司比较表，可横向滚动');
    const evidence = createEvidence();
    const form = make('form', 'cmp-save');
    form.id = 'compare-record';
    const saveSettings = command('比较记录', () => {
      form.scrollIntoView({block:'nearest'});
      nameInput.focus({preventScroll:true});
    });
    tools.append(saveSettings);
    const header = make('div', 'cmp-save-head');
    header.append(make('h2', '', '比较记录'), make('p', 'cmp-muted', '保存在当前设备的浏览器中。'));
    const editor = make('div', 'cmp-editor');
    const nameLabel = make('label', '', '比较名称');
    const nameInput = make('input', 'cmp-input');
    nameInput.maxLength = nameLimit;
    nameInput.placeholder = '可自动按公司命名';
    nameLabel.append(nameInput);
    const projectLabel = make('label', '', '关联融资项目');
    const projectInput = make('select', 'cmp-input');
    projectInput.add(new Option('独立比较', ''));
    projectLabel.append(projectInput);
    const notesLabel = make('label', 'cmp-notes', '备注');
    const notesInput = make('textarea', 'cmp-input');
    notesInput.rows = 3;
    notesInput.maxLength = notesLimit;
    notesLabel.append(notesInput);
    editor.append(nameLabel, projectLabel, notesLabel);
    const saveActions = make('div', 'cmp-save-actions');
    const saveButton = make('button', 'cmp-button cmp-main', '保存比较');
    saveButton.type = 'submit';
    const researchLink = link('judgments.html', '记录研究判断', 'cmp-link');
    researchLink.hidden = true;
    const newComparison = link('compare.html', '回到比较草稿', 'cmp-link');
    newComparison.hidden = true;
    const saveCopy = command('另存为新比较', async () => {
      if (saving) return;
      await saveRecord(true);
    });
    saveCopy.hidden = true;
    saveActions.append(saveButton, saveCopy, researchLink, newComparison);
    const saveStatus = make('p', 'cmp-page-status');
    saveStatus.setAttribute('role', 'status');
    form.append(header, editor, saveActions, saveStatus);
    const blank = make('div', 'cmp-empty');
    root.replaceChildren(mainBar, toolbar, status, scroll, blank, form, evidence.drawer);

    function drawProjects(selected) {
      projectInput.replaceChildren(new Option('独立比较', ''));
      for (const p of knownProjects) projectInput.add(new Option(p.title, p.id));
      if (selected && !knownProjects.some(project => project.id === selected)) {
        projectInput.add(new Option('关联项目当前不可用', selected));
      }
      projectInput.value = selected || '';
    }

    async function drawLibrary() {
      try {
        const items = await store().listResearch('comparison');
        library.replaceChildren(new Option('已保存的比较', ''));
        for (const record of items.sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))) {
          library.add(new Option(record.name || '公司比较', record.id));
        }
        library.value = saved?.id || '';
      } catch { /* Saved-comparison links remain directly accessible. */ }
    }

    function formData() {
      return {name:nameInput.value, fields:selectedFields, notes:notesInput.value, projectId:projectInput.value};
    }

    function applyRecord(record) {
      selectedFields = defaultFields.filter(id => Array.isArray(record?.fields) && record.fields.includes(id));
      if (!selectedFields.length) selectedFields = [...defaultFields];
      for (const [id, check] of fieldToggles) check.checked = selectedFields.includes(id);
      nameInput.value = record?.name || '';
      notesInput.value = record?.notes || '';
      drawProjects(record?.projectId);
    }

    function queueMeta() {
      if (saved || !ready) return;
      clearTimeout(metaTimer);
      metaTimer = setTimeout(() => {
        metaTimer = null;
        const details = formData();
        updateDraft(() => details).catch(error => feedback(message(error, '保存比较草稿失败，输入已保留。')));
      }, 240);
    }

    for (const input of [nameInput, notesInput]) input.addEventListener('input', queueMeta);
    projectInput.addEventListener('change', queueMeta);
    window.addEventListener('pagehide', () => {
      if (!saved && ready && metaTimer) {
        clearTimeout(metaTimer);
        updateDraft(() => formData()).catch(() => {});
      }
    });

    async function changeCompanies(update) {
      if (saving) return false;
      try {
        if (saved) {
          companies = selection(update(companies));
          await loadColumns();
        } else {
          const record = await updateDraft(previous => ({companies:selection(update(selection(previous.companies)))}));
          companies = selection(record.companies);
          await loadColumns();
        }
        return true;
      } catch (error) {
        feedback(message(error, '保存选择失败，请重试。'));
        return false;
      }
    }

    function columnAction(company, label, type, run, disabled) {
      const node = command(label, run, 'cmp-column-button');
      node.setAttribute('aria-label', company.name + ' · ' + type);
      node.title = type;
      node.dataset.cmpFocus = company.id + ':' + type;
      node.disabled = disabled || saving;
      return node;
    }

    function drawTable() {
      const focused = document.activeElement.dataset?.cmpFocus;
      const horizontal = scroll.scrollLeft;
      counts.textContent = companies.length ? '已选 ' + companies.length + ' 家' : '';
      const exportable = display.length >= 2 && display.every(item => item.state !== 'loading');
      copy.disabled = !exportable;
      exportButton.disabled = !exportable;
      saveButton.disabled = !ready || companies.length < 2 || saving;
      saveSettings.hidden = companies.length < 2;
      form.hidden = companies.length < 2;
      for (const control of [nameInput, notesInput, projectInput, ...fieldToggles.values()]) control.disabled = saving;
      const anyPending = display.some(item => item.state === 'loading');
      scroll.setAttribute('aria-busy', String(anyPending));
      scroll.hidden = !display.length;
      blank.hidden = display.length >= 2;
      blank.replaceChildren();
      if (!display.length) blank.append(make('h2', '', '选择 2–5 家公司'), make('p', 'cmp-muted', '可以在此查找，也可以从公司档案和融资检索加入。'));
      if (display.length === 1) blank.append(make('p', 'cmp-muted', '再添加一家公司即可并排比较。'));
      const table = make('table', 'cmp-table');
      table.style.setProperty('--cmp-companies', String(display.length));
      const caption = make('caption', 'cmp-sr', '公司比较');
      const head = table.createTHead();
      const headings = head.insertRow();
      const axis = make('th', 'cmp-axis', '比较字段');
      axis.scope = 'col';
      headings.append(axis);
      display.forEach((company, index) => {
        const th = make('th', 'cmp-company');
        th.scope = 'col';
        th.append(link(hrefFor(company.id), company.name, 'cmp-company-link'));
        const row = company.row;
        if (row?.registeredName && row.registeredName !== company.name) {
          th.append(make('small', 'cmp-company-meta', row.registeredName));
        }
        const kinds = [row?.location, row?.primaryId !== 'unknown' && row?.sub].filter(Boolean).join(' · ');
        if (kinds) th.append(make('small', 'cmp-company-meta', kinds));
        const actions = make('div', 'cmp-column-actions');
        const move = shift => changeCompanies(items => {
          const next = [...items];
          const i = next.findIndex(item => item.id === company.id);
          if (i >= 0 && next[i + shift]) [next[i], next[i + shift]] = [next[i + shift], next[i]];
          return next;
        });
        const remove = () => changeCompanies(items => items.filter(item => item.id !== company.id));
        actions.append(
          columnAction(company, '←', '向左移动', () => move(-1), index === 0),
          columnAction(company, '→', '向右移动', () => move(1), index === display.length - 1),
          columnAction(company, '×', '移除', remove, false)
        );
        th.append(actions);
        if (company.state === 'failed' || company.dealState === 'failed') {
          th.append(command('重试档案', loadColumns, 'cmp-text-button'));
        }
        headings.append(th);
      });
      const body = table.createTBody();
      for (const field of fields.filter(([id]) => selectedFields.includes(id))) {
        const row = body.insertRow();
        const name = make('th', 'cmp-axis', field[1]);
        name.scope = 'row';
        if (field[0] === 'financing') {
          const basis = make('small', 'cmp-axis-note', '按各自披露口径');
          basis.setAttribute('aria-hidden', 'true');
          name.title = field[2];
          name.append(basis);
        }
        row.append(name);
        for (const company of display) {
          const cell = companyCell(company, field[0]);
          row.append(renderCell(cell, () => evidence.open(company, field, cell)));
        }
      }
      table.prepend(caption);
      scroll.replaceChildren(table);
      scroll.scrollLeft = horizontal;
      if (focused) {
        const control = [...scroll.querySelectorAll('[data-cmp-focus]')].find(button => button.dataset.cmpFocus === focused && !button.disabled);
        if (control) control.focus({preventScroll:true});
        else scroll.focus({preventScroll:true});
      }
    }

    async function loadColumns() {
      const keep = new Map(display.filter(company => company.state === 'ready' && company.dealState !== 'failed').map(company => [company.id, company]));
      const request = ++generation;
      display = companies.map(company => keep.get(company.id) || {...company, state:'loading'});
      drawTable();
      const loaded = await Promise.all(display.map(company => company.state === 'ready' ? company : loadCompany(company)));
      if (request !== generation) return;
      const canonical = selection(loaded);
      const byId = new Map(loaded.map(company => [company.id, company]));
      display = canonical.map(company => byId.get(company.id));
      if (JSON.stringify(canonical) !== JSON.stringify(companies)) {
        const previous = companies;
        companies = canonical;
        if (!saved && ready) updateDraft(record => {
          if (JSON.stringify(selection(record.companies)) === JSON.stringify(previous)) return {companies:canonical};
          return null;
        }).catch(error => feedback(message(error, '规范后的档案身份未能保存，请重试。')));
      }
      drawTable();
    }

    async function saveRecord(asCopy = false) {
      if (saving || !ready || companies.length < 2) return;
      saving = true;
      saveCopy.hidden = true;
      drawTable();
      saveStatus.textContent = '正在保存…';
      try {
        const details = formData();
        const pending = {...details, companies, name:details.name.trim() || companies.map(company => company.name).join(' / ').slice(0, nameLimit)};
        const id = !asCopy && saved?.id ? saved.id : crypto.randomUUID();
        saved = await store().saveResearch('comparison', {...pending, id}, asCopy ? undefined : saved?.revision);
        if (metaTimer) clearTimeout(metaTimer);
        history.replaceState(null, '', 'compare.html?id=' + saved.id);
        applyRecord(saved);
        savedLinks();
        await drawLibrary();
        saveStatus.textContent = '比较已保存。';
      } catch (error) {
        saveStatus.textContent = message(error, '比较保存失败，当前输入已保留。');
        if (saved && error.code === 'conflict') saveCopy.hidden = false;
      } finally {
        saving = false;
        drawTable();
      }
    }

    function savedLinks() {
      if (!saved) return;
      researchLink.href = 'judgments.html?' + new URLSearchParams({type:'comparison', id:saved.id});
      researchLink.hidden = false;
      newComparison.hidden = false;
    }

    form.addEventListener('submit', event => {
      event.preventDefault();
      saveRecord();
    });

    async function initialize() {
      feedback('正在读取比较…');
      try {
        if (requestedId && savedId.test(requestedId)) saved = await store()?.getResearch('comparison', requestedId);
        const record = saved || await refreshDraft();
        companies = selection(record?.companies);
        applyRecord(record);
        ready = true;
        if (!saved) {
          listeners.add(() => {
            if (saved || !ready) return;
            const current = selection(currentDraft?.companies);
            if (JSON.stringify(current) !== JSON.stringify(companies)) {
              companies = current;
              loadColumns();
            }
          });
        }
        feedback(requestedId && !saved ? '当前浏览器找不到该比较，已打开本地草稿。' : '');
        if (requestedId && !saved) history.replaceState(null, '', 'compare.html');
        savedLinks();
        loadColumns();
        drawLibrary();
        try {
          knownProjects = await store().listProjects();
          drawProjects(projectInput.value);
        } catch { /* Independent comparison remains available. */ }
      } catch (error) {
        feedback(message(error, '无法读取比较记录，请检查浏览器站点存储后重试。'));
      }
    }
    drawTable();
    initialize();
  }

  const root = qs('#investor-compare');
  if (root) start(root);
  return Object.freeze({button, mountTray});
})();
