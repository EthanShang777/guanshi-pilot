/* Public evidence is fetched once per view. Personal relations are calculated in this tab. */
const investorEvidence = (() => {
  const routePattern = /^(company|institution|deal)\.html\?id=[a-f0-9]{24}$/;
  const kinds = {
    disclosure:'融资披露', historical:'历史补充', source:'补充证据', correction:'资料更正',
    conflict:'待核冲突', review:'字段待复核', text:'文字修正',
  };
  const localDate = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai',dateStyle:'short'});
  const localTime = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'});
  let request;

  function el(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value ?? '';
    if (className) node.className = className;
    return node;
  }

  function publicUrl(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return '';
    try {
      const valid = new URL(url);
      return valid.username || valid.password ? '' : valid.href;
    } catch {
      return '';
    }
  }

  function link(label, href) {
    const node = el('a', label);
    node.href = href;
    node.referrerPolicy = 'no-referrer';
    return node;
  }

  async function loadPublic() {
    request ??= fetch('records/investor-evidence.json')
      .then(async response => {
        if (response.status === 404) return {status:'unavailable', coverage:null, items:[]};
        if (!response.ok) throw new Error('public evidence fetch');
        const data = await response.json();
        if (data.version !== 1 || !data.coverage || !Array.isArray(data.items)) {
          throw new Error('public evidence format');
        }
        if (!data.coverage.through && !data.coverage.historicalBatchThrough && !data.items.length) {
          return {status:'unavailable', coverage:data.coverage, items:[]};
        }
        return {status:data.items.length ? 'ready' : 'empty', coverage:data.coverage, items:data.items};
      })
      .catch(() => {
        request = undefined;
        return {status:'error', coverage:null, items:[]};
      });
    return request;
  }

  function values(collection) {
    if (collection instanceof Map) return [...collection.values()].flat();
    return Array.isArray(collection) ? collection.flat() : Object.values(collection || {}).flat();
  }

  function loadRelations({watches, projects, candidates, judgments, comparisons}) {
    const targets = new Map();
    const byProject = new Map(values(projects).map(project => [project.id, project]));
    const byComparison = new Map(values(comparisons).map(comparison => [comparison.id, comparison]));
    const byCandidates = new Map();

    function add(type, id, reason) {
      if (!id) return;
      const key = (type === 'fund' ? 'institution' : type) + ':' + id;
      if (!targets.has(key)) targets.set(key, []);
      const found = targets.get(key);
      if (!found.includes(reason)) found.push(reason);
    }

    function companyIds(comparison) {
      return values(comparison?.companyIds || comparison?.companies).map(entry =>
        typeof entry === 'string' ? entry : entry.id || entry.companyId);
    }

    function addTarget(target, reason) {
      if (!target) return;
      if (target.type === 'comparison') {
        companyIds(byComparison.get(target.id)).forEach(id => add('company', id, reason));
      } else if (target.type === 'project') {
        add('company', byProject.get(target.id)?.companyId, reason);
        for (const item of byCandidates.get(target.id) || []) {
          add(item.entityType, item.entityId, reason);
          for (const fund of item.funds || []) add('institution', fund.id, reason);
        }
      } else {
        add(target.type, target.id, reason);
      }
    }

    for (const item of values(candidates)) {
      if (item.removedAt) continue;
      if (!byCandidates.has(item.projectId)) byCandidates.set(item.projectId, []);
      byCandidates.get(item.projectId).push(item);
      const project = byProject.get(item.projectId);
      const reason = project?.title ? '项目「'+project.title+'」清单中的机构' : '项目清单中的机构';
      add(item.entityType, item.entityId, reason);
      for (const fund of item.funds || []) add('institution', fund.id, reason);
    }
    for (const watch of values(watches)) {
      const target = watch.target || watch;
      const label = {company:'公司', institution:'机构', fund:'基金', sector:'赛道'}[target.type] || '对象';
      addTarget(target, '你关注的'+label+(target.name ? '「'+target.name+'」' : ''));
    }
    for (const project of byProject.values()) {
      add('company', project.companyId, project.title ? '项目「'+project.title+'」的公司' : '项目中的公司');
    }
    for (const judgment of values(judgments)) {
      for (const target of judgment.targets || []) {
        addTarget(target, judgment.title ? '关联研究问题「'+judgment.title+'」' : '关联已保存的研究问题');
      }
    }
    for (const comparison of byComparison.values()) {
      for (const id of companyIds(comparison)) {
        const name = comparison.name || comparison.title;
        add('company', id, name ? '比较「'+name+'」中的公司' : '已保存比较中的公司');
      }
    }
    return targets;
  }

  async function loadRelated(input = {}) {
    const result = await loadPublic();
    if (result.status !== 'ready') return result;
    const targets = loadRelations(input);
    const items = result.items.flatMap(item => {
      const keys = [
        'company:'+item.companyId,
        ...(item.institutionIds || []).map(id => 'institution:'+id),
        ...(item.sectorIds || []).map(id => 'sector:'+id),
      ];
      const reasons = [...new Set(keys.flatMap(key => targets.get(key) || []))];
      return reasons.length ? [{...item, reason:reasons[0], reasons}] : [];
    });
    return {...result, status:items.length ? 'ready' : 'empty', items};
  }

  function coverageText(coverage) {
    if (!coverage) return '';
    const bounds = [
      ['投中网存档截至', coverage.ledgerThrough],
      ['Dots 已纳入扫描截至', coverage.dotsThrough],
      ['审核批次截至', coverage.historicalBatchThrough],
      ['快照', coverage.snapshotDay || asDay(coverage.snapshotAt)],
    ].filter(([,value]) => value).map(([label,value]) => label+' '+value);
    return bounds.join(' · ');
  }

  function asDay(value) {
    if (typeof value !== 'string' || !value.includes('T')) return value || '';
    const date = new Date(value);
    return Number.isFinite(+date) ? localDate.format(date) : '';
  }

  function sourceCheckText(coverage, source, label) {
    const entry = coverage[source];
    if (!entry || entry.status === 'unavailable') return label+' · 暂无可核对的检查回执';
    const day = asDay(entry.at);
    if (entry.status === 'checked') return label+' · 本次发布有检查回执'+(day ? ' '+day : '');
    return label+' · 本次发布沿用已有资料'+(day ? '，上次有回执 '+day : '');
  }

  function statusText(status, hasRelation = false) {
    if (status === 'error') return '证据变动暂时读取失败。请重试。';
    if (status === 'unavailable') return '当前快照尚未提供证据变动资料。';
    if (status === 'empty' && hasRelation) return '已读取当前公开证据范围，暂未发现与这些对象匹配的变化。';
    if (status === 'empty') return '已读取当前公开证据范围，暂未发现可展示的变化。';
    return '';
  }

  function fourDates(item) {
    const card = el('dl', '', 'investor-evidence-dates');
    const recorded = item.firstSeenAt?.includes('T') ? new Date(item.firstSeenAt) : null;
    const verifiedAt = recorded && Number.isFinite(+recorded) ? localTime.format(recorded)+' 北京时间' : item.firstSeenAt;
    const fields = [
      ['事件日期', item.eventDate], ['披露日期', item.disclosureDate],
      ['实际入库核验', verifiedAt], ['更正生效日期', asDay(item.correctedAt)],
    ];
    if (item.dateKind) fields.push(['融资档案日期口径', item.dateKind]);
    if (item.changeDate && !['disclosure'].includes(item.kind)) {
      fields.push([item.kind === 'historical' ? '审核批次日期' : '档案观察日期', item.changeDate]);
    }
    for (const [label, value] of fields) {
      const row = el('div');
      row.append(el('dt', label), el('dd', value || '未知'));
      card.append(row);
    }
    return card;
  }

  function renderItem(item, {addEvidence, showImpact = true} = {}) {
    const article = el('article', '', 'investor-evidence-row');
    const bar = el('div', '', 'investor-evidence-actions');
    const heading = el('h3', item.title);
    if (routePattern.test(item.href)) bar.append(link('融资档案', item.href));
    if (addEvidence) {
      const add = el('button', '引用证据');
      add.type = 'button';
      add.addEventListener('click', () => addEvidence(item));
      bar.append(add);
    }
    const top = el('div', '', 'investor-evidence-heading');
    top.append(heading, bar);
    article.append(top);
    if (item.reason) article.append(el('p', item.reason, 'investor-evidence-muted'));
    if (showImpact) article.append(el('p', item.impact));
    const sources = (item.sources || []).filter(source => publicUrl(source.url));
    const visibleSource = sources[0];
    if (visibleSource) {
      article.append(sourceLink(visibleSource));
    }
    const details = el('details', '', 'investor-evidence-detail');
    details.append(el('summary', '日期、出处与核对内容'), fourDates(item));
    if (sources.length > 1) {
      const entries = el('ul', '', 'investor-source-list');
      for (const source of sources.slice(1)) {
        const listItem = el('li');
        listItem.append(sourceLink(source));
        entries.append(listItem);
      }
      details.append(entries);
    }
    if (item.differences?.length) {
      const changes = el('dl', '', 'investor-evidence-dates');
      for (const difference of item.differences) {
        const row = el('div');
        row.append(el('dt', difference.field),
          el('dd', (difference.before || '未列明')+' → '+(difference.after || '未列明')));
        changes.append(row);
      }
      details.append(changes);
    }
    details.append(el('p', item.nextAction));
    article.append(details);
    return article;
  }

  function sourceLink(source) {
    const url = publicUrl(source.url);
    const domain = new URL(url).hostname.replace(/^www\./, '');
    return link([source.relation, domain, source.publishedOn || '发布日期未知'].filter(Boolean).join(' · '), url);
  }

  async function publicView(root) {
    const heading = el('div', '', 'investor-evidence-heading');
    heading.append(el('h2', '融资证据'), link('我的研究判断', 'judgments.html'));
    const status = el('p', '正在读取公开证据…', 'investor-evidence-muted');
    status.role = 'status';
    const body = el('div');
    root.replaceChildren(heading, status, body);
    const result = await loadPublic();
    const coverage = coverageText(result.coverage);
    status.textContent = statusText(result.status) || coverage;
    if (result.status === 'error') {
      const button = el('button', '重试');
      button.addEventListener('click', () => publicView(root));
      body.append(button);
    }
    if (result.status !== 'ready' && result.status !== 'empty') return;
    const tools = el('div', '', 'investor-evidence-actions');
    const scope = el('p', result.coverage.scope, 'investor-evidence-muted');
    tools.append(scope);
    const select = el('select');
    select.setAttribute('aria-label', '证据类型');
    select.append(new Option('全部类型', ''));
    for (const [value, label] of Object.entries(kinds)) select.append(new Option(label, value));
    tools.append(select);
    const notes = el('details', '', 'investor-evidence-detail');
    const sourceChecks = el('ul', '', 'investor-source-list');
    sourceChecks.append(el('li', sourceCheckText(result.coverage, 'ledgerCheck', '投中网')),
      el('li', sourceCheckText(result.coverage, 'dotsCheck', 'Dots')));
    notes.append(el('summary', '覆盖与时间口径'), sourceChecks, el('p', result.coverage.notes));
    if (result.status === 'empty') {
      body.append(el('p', coverage, 'investor-evidence-muted'), notes);
      return;
    }
    const list = el('div');
    body.append(tools, notes, list);
    let pageSize = 10;
    function render() {
      const items = result.items.filter(item => !select.value || item.kind === select.value);
      list.replaceChildren();
      if (!items.length) list.append(el('p', '当前公开范围内没有该类型的变化。'));
      for (const item of items.slice(0, pageSize)) list.append(renderItem(item));
      if (items.length > pageSize) {
        const more = el('button', '显示更多证据');
        more.addEventListener('click', () => {
          const next = pageSize;
          pageSize += 10;
          render();
          list.children[next]?.querySelector('a')?.focus();
        });
        list.append(more);
      }
    }
    select.addEventListener('change', () => { pageSize = 10; render(); });
    render();
  }

  return {loadPublic, loadRelated, coverageText, statusText, renderItem, publicView, asDay};
})();

const investorEvidenceRoot = typeof document !== 'undefined' && document.getElementById('investor-evidence');
if (investorEvidenceRoot) investorEvidence.publicView(investorEvidenceRoot);
