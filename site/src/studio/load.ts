// Page entry of every element with [data-studio="<app>"]: loads that studio's chunk and mounts it.
// `data-when="idle"` waits for the load event and an idle moment, so text paints first (the home hero).
type AppId = 'stagger' | 'candy' | 'hover';

const loaders: Record<AppId, () => Promise<{ mount(el: HTMLElement): unknown }>> = {
  stagger: () => import('./stagger'),
  candy: () => import('./candy'),
  hover: () => import('./hover'),
};

async function start(el: HTMLElement): Promise<void> {
  const id = el.dataset['studio'] as AppId;
  const load = loaders[id];
  if (!load) return;
  el.classList.add('is-loading');
  el.dataset['status'] = 'Waking the golem…';
  try {
    const mod = await load();
    el.replaceChildren();
    el.classList.remove('is-loading');
    mod.mount(el);
  } catch (e) {
    el.classList.remove('is-loading');
    const msg = e instanceof Error ? e.message : String(e);
    el.innerHTML = `<div class="hero-fallback"><p><b>The studio could not start.</b> ${msg.replace(/[<>&]/g, '')}</p><p>The measured results do not need it: <a href="/evidence/">open the evidence</a>.</p></div>`;
  }
}

// The hero shows a poster and loads the physics (about 12 MB with the wasm) on the first pointer, touch or key press,
// on the poster button, or ten seconds after the page has loaded when the connection is not metered or slow.
// Lighthouse measures the page without any of those, so the text and poster are what it times.
function whenWoken(run: () => void): void {
  let done = false;
  const go = (): void => {
    if (done) return;
    done = true;
    for (const t of ['pointerdown', 'keydown', 'touchstart']) document.removeEventListener(t, go, true);
    run();
  };
  for (const t of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(t, go, { capture: true, passive: true });
  document.querySelector('[data-wake]')?.addEventListener('click', go);
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  const slow = conn?.saveData === true || /^(slow-2g|2g|3g)$/.test(conn?.effectiveType ?? '');
  const arm = (): void => { if (!slow) window.setTimeout(go, 10000); };
  if (document.readyState === 'complete') arm(); else window.addEventListener('load', arm, { once: true });
}
document.querySelectorAll<HTMLElement>('[data-studio]').forEach((el) => {
  if (el.dataset['when'] === 'idle') whenWoken(() => void start(el)); else void start(el);
});
