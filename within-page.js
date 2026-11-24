(() => {
  const bar = document.querySelector('#local-find');
  const input = bar.querySelector('input');
  const [prev,next,reset] = bar.querySelectorAll('button');
  const count = bar.querySelector('output');
  const root = document.querySelector('main');
  let hits = [], current = -1, opened = [];
  function clear() {
    for (const mark of hits) {
      const parent = mark.parentNode;
      if (parent) {mark.replaceWith(document.createTextNode(mark.textContent));parent.normalize();}
    }
    hits = []; current = -1;
    for (const box of opened) box.open = false;
    opened = [];
  }
  function go(index) {
    if (!hits.length) return;
    if (current >= 0) hits[current].classList.remove('here');
    current = (index + hits.length) % hits.length;
    const hit = hits[current];
    for (let el=hit.parentElement;el && el!==root;el=el.parentElement) {
      if(el.tagName==='DETAILS' && !el.open){el.open=true;opened.push(el);}
    }
    hit.classList.add('here');
    count.textContent=(current+1)+' / '+hits.length;
    hit.scrollIntoView({block:'center',behavior:'instant'});
  }
  function find() {
    clear();
    const q=input.value.trim().toLowerCase();
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];
    if(q) while(walker.nextNode()) {
      const node=walker.currentNode;
      if(!node.parentElement.closest('#local-find,script,style,textarea,input,select,button,[hidden],[aria-hidden="true"]') && node.data.toLowerCase().includes(q)) nodes.push(node);
    }
    for(const node of nodes){
      const text=node.data, lower=text.toLowerCase(), frag=document.createDocumentFragment();
      let start=0, at;
      while((at=lower.indexOf(q,start))!==-1){
        frag.append(text.slice(start,at));
        const mark=document.createElement('mark');
        mark.className='local-hit';mark.textContent=text.slice(at,at+q.length);
        frag.append(mark);hits.push(mark);start=at+q.length;
      }
      frag.append(text.slice(start));node.replaceWith(frag);
    }
    reset.hidden=!input.value;
    prev.hidden=next.hidden=hits.length<2;
    prev.disabled=next.disabled=hits.length<2;
    count.textContent=q?'本页无匹配':'';
    go(0);
  }
  reset.onclick=()=>{input.value='';find();input.focus();};
  prev.onclick=()=>go(current-1);next.onclick=()=>go(current+1);
  input.oninput=e=>{if(!e.isComposing)find()};
  input.addEventListener('compositionend',find);
  input.onkeydown=e=>{if(!e.isComposing && e.key==='Enter'){e.preventDefault();go(current+(e.shiftKey?-1:1))}};
  document.addEventListener('keydown',e=>{if(bar.contains(document.activeElement) && e.key==='Escape') reset.click()});
})();
