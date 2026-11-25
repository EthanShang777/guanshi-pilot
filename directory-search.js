(()=>{
  const form=document.querySelector('.inst-search'), result=document.querySelector('#inst-hits');
  let catalog,version=0;
  form.onsubmit=async e=>{
    e.preventDefault();const seq=++version,q=form.querySelector('input').value.trim().toLowerCase();
    result.textContent='正在查找…';
    try{
      catalog??=await fetch('records/institution-names.json').then(r=>{if(!r.ok)throw Error();return r.json();});
      if(seq!==version)return;
      const hits=catalog.filter(([name])=>name.toLowerCase().includes(q));
      result.textContent=hits.length?'找到 '+hits.length+' 家机构':'没有匹配的机构';
      for(const [name,id] of hits.slice(0,20)){
        const a=document.createElement('a');a.href='institution.html?id='+id;a.textContent=name;result.append(a);
      }
    }catch{result.textContent='机构索引暂时无法读取。';}
  };
})();
