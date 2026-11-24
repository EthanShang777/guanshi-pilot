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
  let touching = false, timer = 0;
  function paint() {
    frame = 0;
    const position = track.scrollLeft / step();
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
  }
  function settle() {
    if (touching) return;
    const offset = track.scrollLeft;
    const nearest = Math.max(0, Math.min(slots.length-1, Math.round(offset/step())));
    if (Math.abs(offset-nearest*step()) > 1.5) return;
    if (current === nearest) return;
    current = nearest;
    slots.forEach((slot,i) => {
      const button = slot.firstElementChild;
      button.setAttribute("aria-label",(i === current ? "进入" : "选择")+button.querySelector("strong").textContent);
    });
    records.forEach((record,i) => record.hidden = i !== current);
    counter.textContent = (current + 1) + ' / ' + slots.length;
    previous.disabled = current === 0;
    next.disabled = current === slots.length - 1;
  }
  function select(i, animate = true) {
    const motion = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({left: i * step(), behavior: motion ? 'smooth' : 'instant'});
  }
  slots.forEach((slot,i) => slot.querySelector('button').onclick = () => {
    if (current === i && Math.abs(track.scrollLeft-i*step()) < 1.5) {
      location.assign(records[i].querySelector('a').href);
    } else select(i);
  });
  previous.onclick = () => select(current - 1);
  next.onclick = () => select(current + 1);
  track.onkeydown = e => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    e.preventDefault();
    select(e.key === 'Home' ? 0 : e.key === 'End' ? slots.length-1 : current + (e.key==='ArrowLeft'?-1:1));
  };
  function scheduleSettle() {
    clearTimeout(timer);
    timer = setTimeout(settle, 160);
  }
  track.addEventListener('touchstart', () => { touching = true; }, {passive:true});
  function release() { touching = false; scheduleSettle(); }
  track.addEventListener('touchend', release, {passive:true});
  track.addEventListener('touchcancel', release, {passive:true});
  track.addEventListener('scrollend', settle);
  track.addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(paint);
    scheduleSettle();
  }, {passive:true});
  select(Math.min(2, Math.floor((slots.length-1)/2)), false);
  paint();
  settle();
  new ResizeObserver(() => { select(current,false); paint(); }).observe(track);
})();
