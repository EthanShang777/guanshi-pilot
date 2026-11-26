(async function () {
  const root = document.querySelector('#inst-app');
  const params = new URLSearchParams(location.search);
  const compare = new Intl.Collator('zh-CN-u-co-pinyin', {numeric:true});
  function el(tag, text, cls) {
    const item = document.createElement(tag);
    if (text != null) item.textContent = text;
    if (cls) item.className = cls;
    return item;
  }
  function link(label, href) {
    const a = el('a', label);
    a.href = href;
    return a;
  }
  function button(label, action) {
    const b = el('button',label);
    b.onclick = action;
    return b;
  }
  async function load(key) {
    const response = await fetch('records/'+key+'.json');
    if (!response.ok) throw Error();
    return response.json();
  }
  const profileUrl = id => 'institution.html?id='+id;
  const norm = s => s.normalize('NFKC').replace(/\s/g,'').toLowerCase();
  const groups = (items, key) => {
    const result = new Map();
    for (const item of items) {
      const value = key(item);
      if (!result.has(value)) result.set(value,[]);
      result.get(value).push(item);
    }
    return result;
  };
  function directory({types,rows}) {
    document.title='机构总览 · 观势';
    const search=el('input'), nav=el('nav'), letters=el('nav'), results=el('div');
    search.type='search'; search.placeholder='搜索机构惯用名、全称或别名';
    search.setAttribute('aria-label',search.placeholder);
    let type=-1, letter='', limit=24;
    rows.sort((a,b)=>compare.compare(a[0],b[0]));
    function render() {
      const query=norm(search.value);
      nav.replaceChildren(); letters.replaceChildren(); results.replaceChildren();
      ['全部类型',...types].forEach((label,i)=>{
        const b=button(label,()=>{type=i-1;letter='';limit=24;render();});
        b.setAttribute('aria-pressed',type===i-1); nav.append(b);
      });
      const matches=rows.filter(r=>(type<0||r[2]===type)&&(!query||[r[0],...r[4]].some(n=>norm(n).includes(query))));
      const initials=[...new Set(matches.map(r=>r[3]))].sort();
      for(const l of ['',...initials]){
        const b=button(l||'全部字母',()=>{letter=l;limit=24;render();});
        b.setAttribute('aria-pressed',l===letter);letters.append(b);
      }
      let more=false;
      for(const [i,label] of types.entries()){
        const items=matches.filter(r=>r[2]===i&&(!letter||r[3]===letter));
        if(!items.length)continue;
        items.sort((a,b)=>a[3].localeCompare(b[3])||compare.compare(a[0],b[0]));
        const section=el('section',null,'inst-group');
        section.append(el('h2',label+' · '+items.length));
        for(const [initial,list] of groups(items.slice(0,limit),r=>r[3])){
          section.append(el('h3',initial));
          const grid=el('div',null,'inst-grid');
          for(const [name,id,,,,count,sectors] of list){
            const a=link(name,profileUrl(id));
            a.append(el('small',[sectors,count+' 家公司'].filter(Boolean).join(' · ')));grid.append(a);
          }
          section.append(grid);
        }
        more ||= items.length>limit;
        results.append(section);
      }
      if(!results.children.length)results.append(el('p','没有匹配的机构。'));
      if(more)results.append(button('显示更多机构',()=>{limit+=48;render();}));
    }
    search.oninput=()=>{letter='';limit=24;render();};
    root.replaceChildren(el('h1','机构总览'),search,nav,letters,results);render();
  }
  async function profile(id) {
    const [index, shard]=await Promise.all([load('institution-directory'),load('institution-'+id.slice(0,2))]);
    const entry=index.rows.find(r=>r[1]===id);
    const row=entry?.[7]?await load('portfolio-'+id):shard[id];
    if(!row)throw Error();
    const name=entry?.[0]||row.name;
    const events=[...row.events].sort((a,b)=>(b[2]||'').localeCompare(a[2]||''));
    const sector=e=>e[5]||'待归类';
    const companyCount=list=>new Set(list.map(e=>e[7])).size;
    document.title=name+' · 机构档案 · 观势';
    root.replaceChildren(link('← 机构总览','institutions.html'),el('h1',name));
    root.append(el('p',[entry&&index.types[entry[2]],companyCount(events)+' 家公司',events.length+' 笔收录交易','最近收录 '+(events[0]?.[2]||'日期未列明')].filter(Boolean).join('　·　'),'inst-meta'));
    if(row.entities || entry?.[4].length){
      const info=el('details');info.append(el('summary','机构名称与关联主体'));
      if(entry?.[4].length)info.append(el('p',entry[4].join('、')));
      for(const [entity,url] of row.entities||[])if(url)info.append(link(entity+' · 管理关系来源',url),el('br'));
      root.append(info);
    }
    const filters=el('div',null,'inst-filters'), layout=el('section'), cases=el('section');
    function select(title,values,initial=''){
      const control=el('select');control.setAttribute('aria-label',title);
      control.append(new Option(title,''));
      for(const v of values)control.append(new Option(v,v));
      control.value=initial;control.onchange=render;filters.append(control);return control;
    }
    const options=fn=>[...new Set(events.map(fn).filter(Boolean))].sort(compare.compare);
    const selected=select('全部赛道',options(sector),params.get('sector')||'');
    const sub=select('全部细分方向',options(e=>e[6]),params.get('sub')||'');
    const stage=select('全部参与轮次',options(e=>e[3]));
    const time=select('全部时间',['近两年']);
    const cutoff=new Date();cutoff.setFullYear(cutoff.getFullYear()-2);
    const earliest=cutoff.toISOString().slice(0,10), today=new Date().toISOString().slice(0,10);
    function render(){
      const base=events.filter(e=>(!time.value||(e[2]>=earliest&&e[2]<=today))&&(!stage.value||stage.value===e[3])&&(!sub.value||sub.value===e[6]));
      const filtered=base.filter(e=>!selected.value||selected.value===sector(e));
      layout.replaceChildren(el('h2','赛道布局'));
      for(const [s,list] of [...groups(filtered,sector)].sort((a,b)=>companyCount(b[1])-companyCount(a[1]))){
        const line=el('div',null,'inst-sector');
        line.append(button(s+' · '+companyCount(list)+' 家',()=>{selected.value=s;render();}));
        for(const values of [...groups(list,e=>e[7]).values()].slice(0,3)){
          const e=values[0];line.append(link(e[1]+(e[6]?' · '+e[6]:''),e[7]));
        }
        line.append(el('small','最近 '+(list[0][2]||'日期未列明')));layout.append(line);
      }
      const portfolio=[...groups(filtered,e=>e[7]).values()];
      cases.replaceChildren(el('h2','投资案例 · '+portfolio.length+' 家'));
      if(!portfolio.length)cases.append(el('p','当前筛选下没有收录案例。'));
      let shown=0;
      function next(){
        for(const list of portfolio.slice(shown,shown+40)){
          const e=list[0], first=list.at(-1), block=el('details',null,'inst-case'), summary=el('summary'), line=el('span',null,'inst-row');
          line.append(el('b',e[1]));
          for(const [label,value] of [['细分方向',e[6]||e[5]],['范围内首次轮次',first[3]],['范围内最近轮次',e[3]],['最近日期',e[2]]]){
            const cell=el('span');cell.append(el('small',label),value||'未列明');line.append(cell);
          }
          summary.append(line);block.append(summary,link('查看公司档案 →',e[7]));
          for(const event of list){
            const p=el('p');p.append(link(event[2]||'日期未列明',event[0]),'　'+(event[3]||'轮次未列明')+'　'+(event[3]==='股权转让'?'转让对价':'本轮融资额')+'　'+(event[4]||'未列明'));block.append(p);
          }
          cases.append(block);
        }
        shown+=40;if(shown<portfolio.length){const more=button('查看更多案例',()=>{more.remove();next();});cases.append(more);}
      }
      next();
    }
    root.append(filters,layout,cases);render();
      if(shard[id]?.fundDisclosures?.length){
        const funds=el('section','');
        funds.className='profile-records';
        funds.append(el('h2',shard[id]?.fundDisclosures.some(fund=>fund.fundId===id)?'有限合伙人（LP）':'旗下基金的有限合伙人（LP）'));
        for(const fund of shard[id]?.fundDisclosures){
          const details=el('details','');
          const count=fund.partners.length+fund.otherLpCount;
          const heading=fund.fundId===id?'查看公开披露':fund.fundName;
          details.append(el('summary',heading+' · '+count+' 位 LP'));
          if(fund.fundId===id && fund.managerId!==id){
            details.append(link('管理人 · '+fund.managerName+' →',profileUrl(fund.managerId)));
          }
          const list=el('ul','');
          for(const partner of fund.partners){
            const item=el('li','');
            item.append(partner.existingInstitution
              ? link(partner.name,profileUrl(partner.existingInstitution))
              : el('span',partner.name));
            const amount=(partner.disclosedContributionCny/10000).toLocaleString('zh-CN',{maximumFractionDigits:4});
            item.append(el('small',' · '+fund.capitalBasis+' '+amount+' 万元 · '+partner.disclosedPercent+'%'));
            list.append(item);
          }
          details.append(list);
          if(fund.otherLpCount)details.append(el('p','另有 '+fund.otherLpCount+' 位个人 LP，见原始披露。'));
          const citation=el('p','');
          citation.append(link(fund.source.issuer+' ↗',fund.source.url),el('small',' · '+fund.source.dateKind+' '+fund.source.date));
          details.append(citation);
          funds.append(details);
        }
        root.append(funds);
      }

  }
  try{
    if(root.dataset.mode==='directory')directory(await load('institution-directory'));
    else {
      const id=params.get('id');
      if(!id){location.replace(root.dataset.default||'institutions.html');return;}
      if(!/^[0-9a-f]{24}$/.test(id))throw Error();
      await profile(id);
    }
  }catch{root.replaceChildren(el('p','机构资料暂时无法读取。'),link('返回机构总览','institutions.html'));}
})();
