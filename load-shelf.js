(async()=>{
  const place=document.querySelector('[data-shelf]');
  try{
    const result=await fetch(place.dataset.shelf);if(!result.ok)return;
    place.innerHTML=await result.text();
    const script=document.createElement('script');script.src='shelf.js';document.body.append(script);
  }catch{/* The main content and navigation are already rendered. */}
})();
