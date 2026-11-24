(() => {
  const $ = selector => document.querySelector(selector);
  const select = $('.atlas-tools select'), search = $('.atlas-tools input');
  const view = $('#atlas-view'), world = $('#atlas-world'), results = $('#atlas-results');
  const status = $('#atlas-status'), back = $('#atlas-back'), open = $('#atlas-open');
  const cache = new Map(), history = [], pointers = new Map();
  let graph, state, loadVersion = 0, moved = false;
  async function data(file) {
    if (!cache.has(file)) cache.set(file, fetch('atlas/'+file).then(response => {
      if (!response.ok) throw Error();
      return response.json();
    }).catch(error => {cache.delete(file);throw error;}));
    return cache.get(file);
  }
  function home() {
    state.x=view.clientWidth/2;state.y=view.clientHeight/2;state.zoom=1;
    transform();
  }
  function transform() {
    world.style.transform='translate('+state.x+'px,'+state.y+'px) scale('+state.zoom+')';
  }
  async function visit(file,id,saved=null,remember=true) {
    const version=++loadVersion;
    try {
      let slice=await data(file);
      if(slice.sharded){
        const part=key=>data(file+'.'+Array.from(key).reduce((sum,c)=>sum+c.codePointAt(0),0)%64);
        const group=await part(id);
        const links=group[id].edges.slice((saved?.page||0)*4,(saved?.page||0)*4+4);
        slice=Object.assign({},group,...await Promise.all(links.map(([key])=>part(key))));
      }
      if(version!==loadVersion)return;
      if(!slice[id])throw Error();
      if(remember && state)history.push({...state});
      graph=slice;state=saved || {file,id,page:0};
      select.value=file;
      if(!saved)home();
      render();
    } catch {if(version===loadVersion)status.textContent='画布加载失败，请重新选择赛道。';}
  }
  function button(label,action) {
    const b=document.createElement('button');b.textContent=label;b.onclick=action;return b;
  }
  function render() {
    world.replaceChildren();
    const n=graph[state.id], pageSize=4;
    const edges=n.edges.slice(state.page*pageSize,(state.page+1)*pageSize);
    function card(id,x,y,label,center) {
      const dest=graph[id], b=button(dest.name,()=>{if(!center)visit(state.file,id);});
      const small=document.createElement('small');small.textContent=dest.summary || label;b.prepend(small);
      b.style.left=x+'px';b.style.top=y+'px';
      if(center)b.className='focus';
      world.append(b);
    }
    edges.forEach(([id,verb],i)=>{
      const a=-Math.PI/2+i*2*Math.PI/edges.length;
      let x=Math.round(Math.cos(a)*Math.min(230,view.clientWidth*.43)), y=Math.round(Math.sin(a)*133);
      if(view.clientWidth<560 && edges.length>1){
        x=(i%2===0?-1:1)*view.clientWidth*.235;
        y=i<2?-125:125;
      }
      const line=document.createElement('i');line.style.width=Math.hypot(x,y)+'px';
      line.style.transform='rotate('+Math.atan2(y,x)+'rad)';world.append(line);
      card(id,x,y,verb,false);
    });
    card(state.id,0,0,n.role,true);
    open.hidden=!n.url;open.href=n.url||'#';back.disabled=!history.length;
    status.replaceChildren(document.createTextNode(n.edges.length+' 个关联 '));
    if(n.edges.length>pageSize){
      const pages=Math.ceil(n.edges.length/pageSize);
      status.append(button('上一组',()=>{visit(state.file,state.id,{...state,page:(state.page+pages-1)%pages},false);}),
        document.createTextNode(' '+(state.page+1)+' / '+pages+' '),
        button('下一组',()=>{visit(state.file,state.id,{...state,page:(state.page+1)%pages},false);}));
    }
    transform();
  }
  function zoom(factor,x,y) {
    if(!state)return;
    const z=Math.max(.45,Math.min(2.8,state.zoom*factor)), ratio=z/state.zoom;
    state.x=x+(state.x-x)*ratio;state.y=y+(state.y-y)*ratio;state.zoom=z;transform();
  }
  view.onwheel=e=>{e.preventDefault();const r=view.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.002),e.clientX-r.left,e.clientY-r.top);};
  view.onpointerdown=e=>{
    if(!state)return;
    if(!pointers.size)moved=false;
    pointers.set(e.pointerId,[e.clientX,e.clientY]);
    e.target.setPointerCapture(e.pointerId);
  };
  view.onpointermove=e=>{
    const prev=pointers.get(e.pointerId);if(!prev)return;
    const dx=e.clientX-prev[0],dy=e.clientY-prev[1];
    if(!moved && Math.hypot(dx,dy)<4 && pointers.size===1)return;
    moved=true;
    const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)?.[1];
    pointers.set(e.pointerId,[e.clientX,e.clientY]);
    if(other){
      const r=view.getBoundingClientRect(), old=Math.hypot(prev[0]-other[0],prev[1]-other[1]);
      if(old>0)zoom(Math.hypot(e.clientX-other[0],e.clientY-other[1])/old,other[0]-r.left,other[1]-r.top);
    }else{state.x+=dx;state.y+=dy;transform();}
  };
  view.onpointerup=view.onpointercancel=e=>pointers.delete(e.pointerId);
  view.addEventListener('click',e=>{if(moved && e.detail){e.stopPropagation();e.preventDefault();}},true);
  $('#atlas-plus').onclick=()=>zoom(1.25,view.clientWidth/2,view.clientHeight/2);
  $('#atlas-minus').onclick=()=>zoom(.8,view.clientWidth/2,view.clientHeight/2);
  $('#atlas-center').onclick=()=>{if(state)home();};
  back.onclick=()=>{const last=history.pop();if(last)visit(last.file,last.id,last,false);};
  function enter(){visit(select.value,select.selectedOptions[0].dataset.root);}
  select.onchange=enter;
  search.oninput=async ()=>{
    const q=search.value.trim().toLowerCase();results.replaceChildren();if(!q)return;
    try {
      const bucket=q.codePointAt(0)%128;const catalog=await data('search.json');const index=Array.isArray(catalog)?(catalog.includes(bucket)?await data('search-'+bucket+'.json'):{}):catalog;if(q!==search.value.trim().toLowerCase())return;
      const names=Object.keys(index).filter(n=>n.toLowerCase().includes(q)).sort((a,b)=>a.length-b.length);
      for(const name of names){
        for(const [file,id] of index[name]){
          const topic=Array.from(select.options).find(o=>o.value===file);
          results.append(button(name+' · '+topic.textContent,()=>{search.value='';results.replaceChildren();visit(file,id);}));
          if(results.children.length===10)return;
        }
      }
      if(!results.children.length)results.textContent='未找到匹配节点';
    }catch{results.textContent='搜索索引加载失败，请重试';}
  };
  enter();
})();
