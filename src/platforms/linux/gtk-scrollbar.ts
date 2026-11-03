/**
 * The Linux app: the scroll bar of the page as the overlay scroll bar of GTK 4, under the header
 * bar. WebKitGTK drew the scroll bar of the window over its whole height, over the header bar and
 * past the rounded corner of the window. Hidden there (linux.css), drawn here instead:
 *
 * - a thin line at the right edge of the page, shown while the page scrolls or the pointer comes
 *   near the edge, gone a second after;
 * - wider under the pointer; dragged, it moves the page; a click on its track brings the page
 *   there (the « primary button warps slider » of GTK).
 *
 * Nothing when the page is not taller than the window.
 */
export function gtkScrollbar(doc: Document): void {
  const root = doc.documentElement;
  const bar = doc.createElement('div');
  bar.className = 'tb-gtk-scrollbar';
  bar.setAttribute('aria-hidden', 'true');
  const thumb = doc.createElement('div');
  thumb.className = 'tb-gtk-thumb';
  bar.append(thumb);
  doc.body.append(bar);

  let track = 0;
  let size = 0;
  let room = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let drag: { y: number; scroll: number } | null = null;

  const update = (): void => {
    room = root.scrollHeight - innerHeight;
    const scrolls = room > 1 && getComputedStyle(doc.body).overflow !== 'hidden';
    bar.classList.toggle('tb-gtk-none', !scrolls);
    if (!scrolls) return;
    track = bar.clientHeight;
    size = Math.max(40, Math.round((track * innerHeight) / root.scrollHeight));
    const y = ((track - size) * Math.min(Math.max(scrollY, 0), room)) / room;
    thumb.style.height = `${size}px`;
    thumb.style.transform = `translateY(${Math.round(y)}px)`;
  };

  const show = (): void => {
    update();
    bar.classList.add('tb-gtk-visible');
    clearTimeout(timer);
    timer = setTimeout(function hide() {
      if (drag || bar.matches(':hover')) timer = setTimeout(hide, 1000);
      else bar.classList.remove('tb-gtk-visible');
    }, 1000);
  };

  addEventListener('scroll', show, { passive: true });
  addEventListener('resize', update);
  new ResizeObserver(update).observe(doc.body);
  // The pointer near the right edge, under the header bar: the bar comes to be grabbed
  addEventListener(
    'pointermove',
    (e) => {
      if (innerWidth - e.clientX < 18 && e.clientY > bar.getBoundingClientRect().top) show();
    },
    { passive: true },
  );

  thumb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    thumb.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, scroll: scrollY };
    bar.classList.add('tb-gtk-dragging');
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!drag || track <= size) return;
    scrollTo({
      top: drag.scroll + ((e.clientY - drag.y) * room) / (track - size),
      behavior: 'instant',
    });
  });
  const end = (): void => {
    if (!drag) return;
    drag = null;
    bar.classList.remove('tb-gtk-dragging');
    show();
  };
  thumb.addEventListener('pointerup', end);
  thumb.addEventListener('pointercancel', end);
  // A click on the track: the middle of the thumb goes where it was clicked
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target === thumb || track <= size) return;
    e.preventDefault();
    const y = e.clientY - bar.getBoundingClientRect().top - size / 2;
    scrollTo({
      top: (Math.min(Math.max(y, 0), track - size) * room) / (track - size),
      behavior: 'instant',
    });
  });
  update();
}
