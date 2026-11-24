const profiles=JSON.parse(document.querySelector('#profiles').textContent);
document.querySelectorAll('.comparison section').forEach((panel,i)=>{
  const select=panel.querySelector('select');
  select.selectedIndex=Math.min(i,profiles.length-1);
  function show(){
    const row=profiles[select.selectedIndex];
    panel.querySelector('h2').textContent=row.name;
    const [finding,question]=panel.querySelectorAll('p');
    finding.textContent=row.claim;question.textContent=row.question?'待验证 · '+row.question:'';
    const [source,detail]=panel.querySelectorAll('a');
    source.textContent=row.source.title;source.href=row.source.url;detail.href=row.href;
  }
  select.addEventListener('change',show);show();
});
