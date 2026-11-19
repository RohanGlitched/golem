// Page entry of every element with [data-studio="<app>"]: loads that studio's chunk and mounts it.
// `data-when="idle"` waits for the load event and an idle moment, so text paints first (the home hero).
type AppId = 'stagger' | 'candy';

const loaders: Record<AppId, () => Promise<{ mount(el: HTMLElement): unknown }>> = {
  stagger: () => import('./stagger'),
  candy: () => import('./candy'),
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

function whenReady(run: () => void): void {
  const go = (): void => {
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(run, { timeout: 1500 }); else window.setTimeout(run, 200);
  };
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}

document.querySelectorAll<HTMLElement>('[data-studio]').forEach((el) => {
  if (el.dataset['when'] === 'idle') whenReady(() => void start(el)); else void start(el);
});
