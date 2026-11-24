(() => {
  const track = document.querySelector('.arc-track');
  if (!track) return;
  const slots = [...track.children];
  const records = [...document.querySelectorAll('.arc-record')];
  const controls = document.querySelector('.arc-controls');
  const [previous, next] = controls.querySelectorAll('button');
  const counter = controls.querySelector('output');
  let current = -1, frame = 0;
  const step = () => slots[0].getBoundingClientRect().width;
  function paint() {
    frame = 0;
    const position = track.scrollLeft / step();
    const nearest = Math.min(slots.length - 1, Math.max(0, Math.round(position)));
    slots.forEach((slot, i) => {
      const d = Math.max(-4, Math.min(4, i - position));
      const angle = Math.tanh(d * .93);
      const depth = Math.abs(angle);
      const face = slot.firstElementChild;
      face.style.transform = 'translateY(' + (-26 * depth) + 'px) perspective(700px) translateZ(' +
        (-65 * depth) + 'px) rotateY(' + (-67 * angle) + 'deg) rotateZ(' + (3 * angle) + 'deg)';
      face.style.setProperty('--lit', Math.max(0, 1 - Math.abs(d)));
      slot.style.zIndex = String(20 - Math.round(Math.abs(d) * 4));
    });
    if (current === nearest) return;
    current = nearest;
    records.forEach((record,i) => record.hidden = i !== current);
    counter.textContent = (current + 1) + ' / ' + slots.length;
    previous.disabled = current === 0;
    next.disabled = current === slots.length - 1;
  }
  function select(i, animate = true) {
    const motion = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({left: i * step(), behavior: motion ? 'smooth' : 'instant'});
  }
  slots.forEach((slot,i) => slot.querySelector('button').onclick = () => select(i));
  previous.onclick = () => select(current - 1);
  next.onclick = () => select(current + 1);
  track.onkeydown = e => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    e.preventDefault();
    select(e.key === 'Home' ? 0 : e.key === 'End' ? slots.length-1 : current + (e.key==='ArrowLeft'?-1:1));
  };
  track.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(paint); }, {passive:true});
  select(Math.min(2, Math.floor((slots.length-1)/2)), false);
  paint();
  new ResizeObserver(() => { select(current,false); paint(); }).observe(track);
})();
