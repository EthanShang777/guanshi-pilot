(() => {
  const rows = JSON.parse(document.querySelector('#search-data').textContent);
  const form = document.querySelector('#archive-form');
  const list = document.querySelector('#matches');
  const count = document.querySelector('#match-count');
  const params = new URLSearchParams(location.search);
  const keys = ['company','investor','sector'];
  const norm = s => s.normalize('NFKC').trim().toLowerCase();
  for (const key of keys) form.elements[key].value = params.get(key) || '';
  let page = Math.max(1, Number(params.get('page')) || 1);
  function render() {
    const [company, investor, sector] = keys.map(k=>norm(form.elements[k].value));
    const found = rows.filter(r=>[r.company,...r.aliases].some(n=>norm(n).includes(company)) &&
      (!investor || r.investors.some(n=>norm(n).includes(investor))) &&
      (!sector || norm(r.sector)===sector));
    const pages = Math.max(1,Math.ceil(found.length/24));
    page = Math.min(pages,Math.max(1,Math.floor(page)));
    const url = new URLSearchParams();
    for (const k of keys) if(form.elements[k].value)url.set(k,form.elements[k].value);
    if(page>1)url.set('page',page);
    history.replaceState(null,'','search.html'+(url.size?'?'+url:'')+location.hash);
    count.textContent = found.length+' 条匹配 · 第 '+page+' / '+pages+' 页';
    list.replaceChildren();
    for (const row of found.slice((page-1)*24,page*24)) {
      const card = document.createElement('article');
      card.className='deal';card.id='r-'+row.key;
      const a=document.createElement('a');
      const ret=new URLSearchParams(url);ret.set('focus',card.id);
      a.href=row.href+'?fromSearch='+encodeURIComponent(ret);
      a.textContent=row.company+' · '+(row.stage || '融资详情');
      const sub=document.createElement('p');sub.textContent=[row.day,row.sector,row.amount].filter(Boolean).join('　');
      card.append(a,sub);list.append(card);
    }
    if(!found.length) list.textContent='没有符合当前条件的融资记录。';
    document.querySelector('#prev').disabled=page<=1;document.querySelector('#next').disabled=page>=pages;
  }
  form.addEventListener('input',()=>{page=1;render()});
  form.addEventListener('submit',e=>{e.preventDefault();render()});
  form.addEventListener('reset',()=>requestAnimationFrame(()=>{page=1;render()}));
  document.querySelector('#prev').onclick=()=>{page--;render();count.scrollIntoView()};
  document.querySelector('#next').onclick=()=>{page++;render();count.scrollIntoView()};
  render();
  if(location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();
