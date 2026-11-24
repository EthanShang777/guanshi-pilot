(() => {
  const input = document.querySelector('#lookup');
  const list = document.querySelector('#found');
  const status = document.querySelector('#found-count');
  const more = document.querySelector('#show-more');
  const normalize = value => value.normalize('NFKC').toLowerCase();
  const rows = JSON.parse(document.querySelector('#lookup-index').textContent)
    .map(([title, kind, url, text]) => ({title, kind, url, name:normalize(title), text:normalize(text)}));
  input.value = new URLSearchParams(location.search).get('q') || '';
  let limit = 20;
  function draw() {
    const query = input.value.trim();
    const words = normalize(query).split(/\s+/).filter(Boolean);
    const matches = words.length ? rows.filter(row => words.every(word=>
      row.name.includes(word) || row.kind.includes(word) || row.text.includes(word)))
      .sort((a,b)=>Number(b.name===normalize(query))-Number(a.name===normalize(query)) ||
        Number(b.name.includes(words[0]))-Number(a.name.includes(words[0]))) : [];
    list.replaceChildren();
    for (const row of matches.slice(0,limit)) {
      const a=document.createElement('a');
      a.href=row.url;
      const label=document.createElement('small');label.textContent=row.kind;
      const title=document.createElement('strong');title.textContent=row.title;
      a.append(label,title);list.append(a);
    }
    status.textContent=words.length ? (matches.length ? matches.length+' 条结果' : '没有找到，可试试公司简称或赛道名。') : '';
    more.hidden=matches.length<=limit;
    const params=new URLSearchParams();
    if(query)params.set('q',query);
    history.replaceState(null,'','find.html'+(query?'?'+params:''));
  }
  input.addEventListener('input',e=>{if(!e.isComposing){limit=20;draw()}});
  input.addEventListener('compositionend',()=>{limit=20;draw()});
  input.form.addEventListener('submit',e=>{e.preventDefault();draw()});
  more.onclick=()=>{limit+=20;draw()};
  draw();
})();
