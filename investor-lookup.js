(() => {
  const root=document.querySelector('#investor-lookup');
  if(!root)return;
  const params=new URLSearchParams(location.search);
  const raw=params.get('q')?.slice(0,120).trim()||'';
  const normalize=value=>value.normalize('NFKC').trim().toLowerCase();
  const query=normalize(raw);
  const field=document.querySelector('#site-query');
  field.value=raw;
  const el=(name,value)=>{const node=document.createElement(name);if(value)node.textContent=value;return node;};
  const link=(label,href)=>{const a=el('a',label);a.href=href;return a;};
  const subheading=el('p',query?'查找「'+raw+'」':'输入公司或机构名称开始查找。');
  subheading.className='task-state'; root.append(subheading);
  if(!query)return;
  const host=el('div');host.className='lookup-results';root.append(host);
  const cache=new Map();
  function load(name){
    if(!cache.has(name))cache.set(name,fetch('records/'+name+'.json').then(r=>{if(!r.ok)throw Error();return r.json();})
      .catch(error=>{cache.delete(name);throw error;}));
    return cache.get(name);
  }
  const includes=(name,aliases)=>[name,...(aliases||[])].some(value=>normalize(value).includes(query));
  function group(title,type,loadRows){
    const panel=el('section');panel.className='workbench-panel';
    const top=el('header');top.append(el('h2',title));panel.append(top);host.append(panel);
    const status=el('p','正在检索…');status.className='task-state';status.setAttribute('role','status');panel.append(status);
    const list=el('ul');list.className='workbench-list';panel.append(list);
    const nav=el('nav');nav.className='task-links';nav.setAttribute('aria-label',title+'翻页');panel.append(nav);
    let positions,seen=Math.max(0,Math.min(180,Number(history.state?.[type])||0));
    async function show(){
      status.textContent='正在检索…';
      nav.replaceChildren();
      try{
        positions??=await loadRows();
        const rows=await Promise.all(positions.slice(0,seen+12).map(value=>value()));
        list.replaceChildren(...rows.filter(Boolean).map(({id,name,details})=>{
          const li=el('li');li.className='lookup-hit';
          const heading=el('strong');heading.append(link(name,type+'.html?id='+id));
          li.append(heading);
          if(details)li.append(el('small',details));
          if(type==='company'&&typeof investorCompare!=='undefined')li.append(investorCompare.button(id,name));
          return li;
        }));
        status.textContent=positions.length?`${positions.length.toLocaleString('zh-CN')} 项 · 已显示 ${rows.length}`:'没有匹配结果';
        if(rows.length<positions.length){
          const more=el('button','显示更多'+title);more.type='button';
          more.onclick=()=>{
            seen+=12;
            history.replaceState({...history.state,[type]:seen},'');
            show();
          };
          nav.append(more);
        }
      }catch{
        status.textContent=title+'索引暂时无法读取。';
        const retry=el('button','重试');retry.onclick=()=>show();nav.append(retry);
      }
    }
    show();
  }
  group('公司','company',async()=>{
    const lookup=await load('company-lookup');
    return lookup.flatMap(([name,aliases],i)=>includes(name,aliases)?[async()=>{
      const [id,display,area,sector]=(await load('company-summary-'+Math.floor(i/30)))[i%30];
      return {id,name:display,details:[area,sector].filter(Boolean).join(' · ')};
    }]:[]);
  });
  group('机构与基金','institution',async()=>{
    const [names,manifest]=await Promise.all([load('institution-names'),load('manifest')]);
    return names.flatMap(([name,id])=>includes(name,manifest.institutionAliases?.[name])?[()=>({id,name})]:[]);
  });
  if(typeof investorCompare!=='undefined')investorCompare.mountTray(root);
})();
