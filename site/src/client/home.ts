// Home page: mounts the Summoning Circle in the scroll hero and swaps the captions as the campaign replays.
// The captions are in the HTML (data-caps, data-caps-kiro), so the page reads fully without WebGL or JavaScript.
// The switch replays the same recorded shoves with Kiro's reflex (pack-kiro) instead of Unitree's policy alone (pack).
import { mountCircle } from '../hero/circle';

interface Cap { at: number; k: string; h: string; p: string }

const stage = document.querySelector<HTMLElement>('[data-circle]');
const cap = document.querySelector<HTMLElement>('[data-circle-cap]');
if (stage && cap) {
  const sets: Record<string, Cap[]> = {
    pack: JSON.parse(stage.dataset.caps ?? '[]') as Cap[],
    'pack-kiro': JSON.parse(stage.dataset.capsKiro ?? '[]') as Cap[],
  };
  let mode = 'pack';
  const k = cap.querySelector('.k') as HTMLElement, h = cap.querySelector('.cap-h') as HTMLElement, p = cap.querySelector('.cap-p') as HTMLElement;
  const hint = document.querySelector<HTMLElement>('.circle-hint');
  const section = document.querySelector<HTMLElement>('[data-circle-scroll]');
  const onHero = (): void => { if (section) document.body.classList.toggle('on-hero', section.getBoundingClientRect().bottom > window.innerHeight * 0.6); };
  window.addEventListener('scroll', onHero, { passive: true }); onHero();
  const dots = [...document.querySelectorAll<HTMLElement>('.circle-dots i')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let shown = 0, timer = 0;
  const render = (i: number): void => {
    dots.forEach((d, j) => d.classList.toggle('on', j === i));
    window.clearTimeout(timer);
    cap.classList.add('swap');
    timer = window.setTimeout(() => {
      const c = sets[mode]![i]!;
      k.textContent = c.k; h.textContent = c.h; p.textContent = c.p;
      cap.classList.remove('swap');
    }, reduced ? 0 : 260);
  };
  const show = (i: number): void => { if (i !== shown) { shown = i; render(i); } };
  const onProgress = (v: number): void => {
    let i = 0; sets[mode]!.forEach((c, j) => { if (v >= c.at) i = j; });
    show(i); hint?.classList.toggle('gone', v > 0.9);
  };
  const gl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.circle-toggle button')];
  if (gl) {
    let current: Promise<{ dispose(): void } | undefined> = Promise.resolve(undefined);
    const mount = (pack: string): void => {
      const prev = current;
      current = mountCircle(stage, { base: '/hero/', pack, line: stage.dataset.line ?? '', reduced, onProgress })
        .then(async (c) => { (await prev)?.dispose(); stage.querySelector('.circle-fallback')?.remove(); return c; })
        .catch((e: unknown) => { stage.dataset.error = String((e as Error)?.message ?? e); return prev; });
    };
    mount('pack');
    buttons.forEach((b) => b.addEventListener('click', () => {
      const pack = b.dataset.pack ?? 'pack';
      if (pack === mode) return;
      mode = pack;
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      stage.dataset.mode = pack;
      render(shown);
      mount(pack);
    }));
  } else {
    buttons.forEach((b) => { b.disabled = true; });
  }
}
