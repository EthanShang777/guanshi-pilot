const investorActions = (() => {
  const publicId = /^[a-f0-9]{24}$/;
  const sectorId = /^[a-z][a-z0-9-]{1,64}$/;
  const node = (tag,text) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    return el;
  };
  function watchTarget(type,id,name) {
    if (!name || !(type==='sector' ? sectorId.test(id) : ['company','institution'].includes(type)&&publicId.test(id))) return null;
    const href = type==='sector' ? 'companies.html?sector='+encodeURIComponent(id) : type+'.html?id='+id;
    return {type,id,name,href};
  }
  function judgmentLink(type,id,label='记录研究判断') {
    const link = node('a',label);
    link.className='task-button';
    link.href='judgments.html?'+new URLSearchParams({type,id});
    return link;
  }
  function watchButton(target) {
    const id = `${target.type}:${target.id}`;
    const control=node('button','关注'); control.type='button';
    const status=node('span'); status.className='task-state'; status.setAttribute('role','status');
    const group=node('span'); group.className='watch-action'; group.append(control,status);
    let current=null;
    async function refresh() {
      current=await faStore.getResearch('watch',id);
      control.textContent=current?'已关注':'关注';
      control.setAttribute('aria-pressed',String(!!current));
      control.disabled=false;
    }
    control.disabled=true;
    refresh().catch(error=>{status.textContent=error.message;});
    control.onclick=async()=>{
      control.disabled=true; status.textContent='';
      try {
        if(current)await faStore.removeResearch('watch',id,current.revision);
        else await faStore.saveResearch('watch',{id,target});
        await refresh();
        status.textContent=current?'已保存关注':'已取消关注';
      }catch(error){status.textContent=error.message; await refresh().catch(()=>{control.disabled=false;});}
    };
    faStore.subscribe(change=>{
      if(group.isConnected && (change.kind==='import' || change.kind==='research'&&change.id===id)) {
        refresh().catch(error=>{status.textContent=error.message;});
      }
    });
    return group;
  }
  function addDetail() {
    const institution=document.querySelector('#inst-app[data-mode="profile"]');
    const root=institution || document.querySelector('#record[data-kind="company"]');
    const container=institution || document.querySelector('main .hero');
    if(!root||!container)return;
    const kind=institution?'institution':'company', id=new URLSearchParams(location.search).get('id') || '';
    if(!publicId.test(id))return;
    const initial=kind==='company'?'公司档案':'机构档案';
    const buttons=node('div'); buttons.className='research-object-actions task-links';
    const mount=()=>{
      const heading=container.querySelector('h1'), name=heading?.textContent.trim();
      if(name===initial||!name||buttons.isConnected)return;
      buttons.append(watchButton(watchTarget(kind,id,name)),judgmentLink(kind,id));
      const companyActions=root.querySelector('.fa-company-actions');
      if(companyActions)companyActions.after(buttons);
      else if(institution)heading.after(buttons);
      else root.prepend(buttons);
    };
    const observer=new MutationObserver(()=>{mount();if(buttons.isConnected)observer.disconnect();});
    observer.observe(container,{childList:true,subtree:true,characterData:true}); mount();
  }
  async function addProject() {
    if(!location.pathname.endsWith('/projects.html'))return;
    const id=new URLSearchParams(location.search).get('project');
    if(!id||!await faStore.getProject(id))return;
    const host=document.querySelector('#fa-projects');
    const actions=node('div');actions.className='research-object-actions task-links';
    actions.append(judgmentLink('project',id));host?.before(actions);
  }
  addDetail(); addProject().catch(()=>{});
  return {watchTarget,judgmentLink};
})();
