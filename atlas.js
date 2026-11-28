(() => {
  const $ = selector => document.querySelector(selector);
  const form = $('.atlas-tools');
  if (!form || !$('#atlas-directory')) return;

  const scope = $('#atlas-scope');
  const role = $('#atlas-role');
  const query = $('#atlas-query');
  const view = $('#atlas-view');
  const world = $('#atlas-world');
  const brief = $('#atlas-brief');
  const graph = $('#atlas-graph');
  const directory = $('#atlas-directory');
  const status = $('#atlas-status');
  const retry = $('#atlas-retry');
  const back = $('#atlas-back');
  const showGraph = $('#atlas-show-graph');
  const showList = $('#atlas-show-list');
  const params = new URLSearchParams(location.search);
  const savedScope = params.get('scope') || params.get('sector');
  const scopes = [...scope.options];
  const initialScope = scopes.find(option => option.dataset.scope === savedScope || option.textContent === savedScope);
  if (initialScope) scope.value = initialScope.value;
  query.value = (params.get('q') || '').slice(0, 120);

  const pageNumber = value => Math.max(0, (Number.parseInt(value, 10) || 1) - 1);
  const state = {
    mode: params.get('view') === 'list' ? 'list' : 'graph',
    query: query.value.trim(),
    role: params.get('type') || '',
    focus: (params.get('node') || '').slice(0, 500),
    focusScope: params.get('focusScope') || '',
    group: pageNumber(params.get('group')),
    page: pageNumber(params.get('page'))
  };
  const cache = new Map();
  const trail = [];
  const pointers = new Map();
  const position = {x:0, y:0, zoom:1};
  const pageSize = 20;
  const groupSize = 4;
  let version = 0;
  let moved = false;
  let currentGraph;

  function data(file) {
    if (!cache.has(file)) {
      const request = fetch('atlas/'+file).then(response => {
        if (!response.ok) throw Error('Atlas request failed');
        return response.json();
      }).catch(error => {
        if (cache.get(file) === request) cache.delete(file);
        throw error;
      });
      cache.set(file, request);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
    }
    return cache.get(file);
  }

  function element(tag, label, className) {
    const node = document.createElement(tag);
    if (label) node.textContent = label;
    if (className) node.className = className;
    return node;
  }

  function link(href, label) {
    const node = element('a', label);
    node.href = href;
    return node;
  }

  function button(label, action) {
    const node = element('button', label);
    node.type = 'button';
    node.onclick = action;
    return node;
  }

  function key(name) {
    return name.normalize('NFKC').toLowerCase();
  }

  function writeLocation() {
    const options = {
      scope: scope.selectedOptions[0].dataset.scope,
      q: state.query,
      type: state.role,
      view: state.mode === 'list' ? 'list' : '',
      page: state.page ? state.page + 1 : '',
      node: state.focus === scope.selectedOptions[0].dataset.root ? '' : state.focus,
      focusScope: scope.selectedOptions[0].dataset.scope === 'all' ? state.focusScope : '',
      group: state.group ? state.group + 1 : ''
    };
    const url = new URL(location.href);
    url.search = new URLSearchParams(Object.entries(options).filter(([,value]) => value));
    history.replaceState(history.state, '', url);
  }

  function filterRoles(entries) {
    const selected = entries.some(([name]) => name === state.role) ? state.role : '';
    state.role = selected;
    role.replaceChildren(new Option('全部对象', ''), ...entries.map(([name]) => new Option(name, name)));
    role.value = selected;
    return selected ? entries.filter(([name]) => name === selected) : entries;
  }

  async function filteredRanges(file, groups, search) {
    const candidates = groups.flatMap(([name, ranges]) => ranges.map(range => [name, ...range]));
    const result = await Promise.all(candidates.map(async ([name, part, first, last, count, groupFile = file]) => {
      if (!search || (first.startsWith(search) && last.startsWith(search))) return {name, groupFile, part, count, start:0};
      if (last < search || (first >= search && !first.startsWith(search))) return null;
      const contents = await data(groupFile+'.list-'+part);
      const start = contents.findIndex(([,label]) => key(label).startsWith(search));
      if (start < 0) return null;
      const firstOutside = contents.findIndex(([,label], index) => index > start && !key(label).startsWith(search));
      return {name, groupFile, part, start, count:(firstOutside < 0 ? contents.length : firstOutside)-start};
    }));
    return result.filter(Boolean);
  }

  async function listSlice(ranges, start, size) {
    const blocks = [];
    let offset = 0;
    for (const range of ranges) {
      const end = offset + range.count;
      if (end > start && offset < start+size) {
        const from = range.start + Math.max(0, start - offset);
        const limit = range.start + Math.min(range.count, start + size - offset);
        blocks.push(data(range.groupFile+'.list-'+range.part).then(items => items.slice(from, limit).map(item => [range.name,...item,range.groupFile])));
      }
      offset = end;
      if (offset >= start + size) break;
    }
    return (await Promise.all(blocks)).flat();
  }

  function renderDirectory(entries, total, pages, allScopes) {
    const body = $('#atlas-items');
    body.replaceChildren(...entries.map(([type, id, name, url, count, file]) => {
      const row = element('tr');
      const title = element('th', name);
      title.scope = 'row';
      if (allScopes) title.append(element('small', scopes.find(item => item.value === file).textContent, 'atlas-result-scope'));
      const actions = element('td', '', 'atlas-row-actions');
      const graphLink = button('图中打开', () => openNode(id, file));
      graphLink.setAttribute('aria-label', '在图中打开 '+name);
      actions.append(graphLink);
      if (url) actions.append(link(url, type === '研究事件' ? '查看证据' : '打开档案'));
      row.append(title, element('td', type), element('td', String(count)), actions);
      return row;
    }));
    if (!total) {
      const row = element('tr');
      const cell = element('td', '当前范围没有匹配对象。可调整名称或对象类型。');
      cell.colSpan = 4;
      row.append(cell);
      body.append(row);
    }
    directory.querySelector('.atlas-pager').hidden = pages <= 1;
    $('#atlas-count').textContent = `第 ${state.page+1} / ${pages} 页`;
    $('#atlas-prev').disabled = state.page === 0;
    $('#atlas-next').disabled = state.page+1 >= pages;
  }

  function lookupNode(file, index, id) {
    if (!index.sharded) return Promise.resolve(Object.hasOwn(index,id) ? index[id] : undefined);
    const bucket = Array.from(id).reduce((sum,c) => sum+c.codePointAt(0), 0)%64;
    if (index.buckets && !index.buckets.includes(bucket)) return Promise.resolve();
    return data(file+'.'+bucket).then(part => Object.hasOwn(part,id) ? part[id] : undefined);
  }

  async function loadGraph(file, focus, index) {
    const center = await lookupNode(file, index, focus);
    if (!center) return null;
    const total = center.edgeCount || center.edges.length;
    const pages = Math.max(1, Math.ceil(total/groupSize));
    const page = Math.min(state.group, pages-1);
    const start = page*groupSize;
    let source = center.edges;
    let offset = start;
    if (center.edgeFile) {
      source = await data(center.edgeFile+'-'+Math.floor(start/40));
      offset %= 40;
    }
    const edges = await Promise.all(source.slice(offset,offset+groupSize).map(async ([id, verb, route, label]) =>
      ({id, node:await lookupNode(file,index,id), verb, route, label})));
    return {focus, center, edges:edges.filter(edge => edge.node), page, pages, total};
  }

  function belongs(node) {
    return (!state.role || node.role === state.role) && (!state.query || key(node.name).startsWith(key(state.query)));
  }

  function renderGraph() {
    const {center, edges, pages, total, file} = currentGraph;
    const parent = scopes.find(item => item.value === file);
    world.replaceChildren();
    const smallViewport = view.clientWidth < 570;
    const nodeWidth = Math.min(170, view.clientWidth*.42);
    function card(node, x, y, roleLabel, action) {
      const b = action ? button(node.name, action) : element('div', node.name);
      const name = element('span', node.name);
      b.replaceChildren(element('small', roleLabel), name);
      b.classList.add('atlas-node');
      if (!action) {
        b.classList.add('atlas-focus');
        b.tabIndex = -1;
      }
      b.title = node.name;
      b.style.left = x+'px';
      b.style.top = y+'px';
      b.style.width = nodeWidth+'px';
      world.append(b);
      return b;
    }
    edges.forEach(({id,node,verb},i) => {
      const angle = -Math.PI/2+i*2*Math.PI/edges.length;
      let x = Math.round(Math.cos(angle)*Math.min(240, view.clientWidth*.35));
      let y = Math.round(Math.sin(angle)*116);
      if (smallViewport && edges.length > 1) {
        x = (i%2 === 0 ? -1 : 1)*view.clientWidth*.235;
        y = i < 2 ? -108 : 108;
      }
      const line = element('i');
      line.style.width = Math.hypot(x,y)+'px';
      line.style.transform = 'rotate('+Math.atan2(y,x)+'rad)';
      world.append(line);
      const label = node.role === verb ? node.role : node.role+' · '+verb;
      const nodeCard = card(node,x,y,label,() => openNode(id, file));
      if (!belongs(node)) nodeCard.classList.add('atlas-context');
    });
    card(center,0,0,center.role);

    const title = element('h2', center.name);
    const info = element('p', [center.role, center.summary, `${total} 个直接关系`].filter(Boolean).join(' · '));
    brief.replaceChildren(title, info);
    if (center.url) brief.append(link(center.url, center.role === '研究事件' ? '查看报告证据' : '打开档案'));
    if (scope.selectedOptions[0].dataset.scope === 'all') brief.append(element('p', parent.textContent, 'atlas-context-note'));
    if (['融资赛道', '子赛道', '业务方向'].includes(center.role)) {
      brief.append(link('judgments.html?'+new URLSearchParams({type:'sector', id:parent.dataset.scope}), '记录赛道判断'));
    }
    if (!belongs(center)) brief.append(element('p','此焦点来自当前筛选对象的关系。','atlas-context-note'));
    if (edges.length) {
      const list = element('ul', '', 'atlas-relationships');
      for (const edge of edges) {
        const row = element('li');
        row.append(element('small', edge.verb + (belongs(edge.node) ? '' : ' · 关联对象')),
          button(edge.node.name, () => openNode(edge.id, file)));
        if (edge.route) row.append(link(edge.route, edge.label));
        list.append(row);
      }
      brief.append(list);
    }
    $('#atlas-graph-pager').hidden = pages <= 1;
    $('#atlas-graph-count').textContent = `第 ${state.group+1} / ${pages} 组`;
    $('#atlas-graph-prev').disabled = state.group === 0;
    $('#atlas-graph-next').disabled = state.group+1 >= pages;
    back.disabled = trail.length === 0;
    transform();
  }

  async function refresh({center = false} = {}) {
    const current = ++version;
    const option = scope.selectedOptions[0];
    const file = option.value;
    const allScopes = option.dataset.scope === 'all';
    writeLocation();
    showGraph.setAttribute('aria-pressed', String(state.mode === 'graph'));
    showList.setAttribute('aria-pressed', String(state.mode === 'list'));
    status.textContent = '正在读取关系索引…';
    retry.hidden = true;
    graph.setAttribute('aria-busy','true');
    directory.setAttribute('aria-busy','true');
    if (state.mode === 'graph') directory.hidden = true;
    else graph.hidden = true;
    try {
      const groups = await data(allScopes ? file : file+'.directory');
      if (current !== version) return;
      const ranges = await filteredRanges(file, filterRoles(groups), key(state.query));
      if (current !== version) return;
      const total = ranges.reduce((sum, range) => sum+range.count, 0);
      const pages = Math.max(1, Math.ceil(total/pageSize));
      state.page = Math.min(state.page, pages-1);
      if (state.mode === 'list') {
        const entries = await listSlice(ranges,state.page*pageSize,pageSize);
        if (current !== version) return;
        directory.hidden = false;
        renderDirectory(entries,total,pages,allScopes);
      } else if (total) {
        const first = (allScopes || state.role || state.query) ? (await listSlice(ranges,0,1))[0] : null;
        if (current !== version) return;
        const defaultFocus = first ? first[1] : option.dataset.root;
        const defaultFile = first ? first[5] : file;
        const savedFile = scopes.find(item => item.dataset.scope !== 'all' && item.dataset.scope === state.focusScope)?.value;
        let graphFile = allScopes ? (savedFile || defaultFile) : file;
        const id = state.focus || defaultFocus;
        const initialRoot = !allScopes && id === option.dataset.root && !state.group;
        const index = await data(initialRoot ? graphFile+'.root' : graphFile);
        if (current !== version) return;
        let local = await loadGraph(graphFile,id,index);
        if (!local) {
          graphFile = defaultFile;
          local = await loadGraph(graphFile,defaultFocus,await data(graphFile));
        }
        if (current !== version) return;
        if (!local) throw Error('Atlas node missing');
        graph.hidden = false;
        const changed = currentGraph?.focus !== local.focus || currentGraph?.file !== graphFile;
        currentGraph = {...local,file:graphFile};
        state.focus = local.focus;
        state.focusScope = scopes.find(item => item.value === graphFile).dataset.scope;
        state.group = local.page;
        if (changed || !position.x) home();
        renderGraph();
      } else {
        graph.hidden = true;
      }
      status.textContent = total ? `${option.textContent} · ${total.toLocaleString('zh-CN')} 个${allScopes ? '范围内节点' : '对象'}`+
        (state.mode === 'graph' ? ' · 图中展示焦点及其直接关系' : '') : '当前范围没有匹配对象。';
      writeLocation();
    } catch (error) {
      if (current !== version) return;
      graph.hidden = true;
      directory.hidden = true;
      status.textContent = '关系索引加载失败。已保留筛选条件。';
      retry.hidden = false;
    } finally {
      if (current === version) {
        graph.removeAttribute('aria-busy');
        directory.removeAttribute('aria-busy');
        if (center && !graph.hidden) world.querySelector('.atlas-focus')?.focus({preventScroll:true});
      }
    }
  }

  function openNode(id, file) {
    const destination = scopes.find(item => item.value === file).dataset.scope;
    if (state.focus && (state.focus !== id || state.focusScope !== destination)) trail.push([state.focus,state.group,state.focusScope]);
    state.focus = id;
    state.focusScope = destination;
    state.group = 0;
    state.mode = 'graph';
    refresh({center:true});
  }

  function clearSelection() {
    trail.length = 0;
    state.focus = '';
    state.focusScope = '';
    state.group = 0;
    state.page = 0;
  }

  function home() {
    position.x = view.clientWidth/2;
    position.y = view.clientHeight/2;
    position.zoom = 1;
    transform();
  }

  function transform() {
    world.style.transform = `translate(${position.x}px,${position.y}px) scale(${position.zoom})`;
  }

  function zoom(factor,x,y) {
    const z = Math.max(.55,Math.min(2.5,position.zoom*factor));
    const ratio = z/position.zoom;
    position.x = x+(position.x-x)*ratio;
    position.y = y+(position.y-y)*ratio;
    position.zoom = z;
    transform();
  }

  view.onwheel = e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = view.getBoundingClientRect();
    zoom(Math.exp(-e.deltaY*.002),e.clientX-r.left,e.clientY-r.top);
  };
  view.onpointerdown = e => {
    if (!currentGraph) return;
    if (!pointers.size) moved = false;
    pointers.set(e.pointerId,[e.clientX,e.clientY]);
    e.target.setPointerCapture(e.pointerId);
  };
  view.onpointermove = e => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX-prev[0], dy = e.clientY-prev[1];
    if (!moved && Math.hypot(dx,dy)<4 && pointers.size === 1) return;
    moved = true;
    const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)?.[1];
    pointers.set(e.pointerId,[e.clientX,e.clientY]);
    if (other) {
      const r = view.getBoundingClientRect(), old = Math.hypot(prev[0]-other[0],prev[1]-other[1]);
      if (old > 0) zoom(Math.hypot(e.clientX-other[0],e.clientY-other[1])/old,other[0]-r.left,other[1]-r.top);
    } else {
      position.x += dx;
      position.y += dy;
      transform();
    }
  };
  view.onpointerup = view.onpointercancel = e => pointers.delete(e.pointerId);
  view.addEventListener('click',e => {if (moved && e.detail) {e.stopPropagation();e.preventDefault();}},true);
  $('#atlas-plus').onclick = () => zoom(1.25,view.clientWidth/2,view.clientHeight/2);
  $('#atlas-minus').onclick = () => zoom(.8,view.clientWidth/2,view.clientHeight/2);
  $('#atlas-center').onclick = home;
  back.onclick = () => {
    const last = trail.pop();
    if (!last) return;
    [state.focus,state.group,state.focusScope] = last;
    refresh({center:true});
  };
  $('#atlas-graph-prev').onclick = () => {state.group-=1;refresh();};
  $('#atlas-graph-next').onclick = () => {state.group+=1;refresh();};
  $('#atlas-prev').onclick = () => {state.page-=1;refresh();};
  $('#atlas-next').onclick = () => {state.page+=1;refresh();};
  showList.onclick = () => {state.mode='list';refresh();};
  showGraph.onclick = () => {state.mode='graph';refresh();};
  retry.onclick = () => refresh();
  scope.onchange = role.onchange = () => {
    state.role = role.value;
    state.query = query.value.trim();
    clearSelection();
    refresh();
  };
  form.onsubmit = e => {
    e.preventDefault();
    state.query = query.value.trim();
    clearSelection();
    refresh();
  };
  window.addEventListener('resize', () => {
    if (!graph.hidden && currentGraph) {home();renderGraph();}
  });
  refresh();
})();
