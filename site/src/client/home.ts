// Home page: mounts the Summoning Circle in the scroll hero and swaps the captions as the campaign replays.
// The captions are in the HTML (data-caps), so the page reads fully without WebGL or JavaScript.
import { mountCircle } from '../hero/circle';

interface Cap { at: number; k: string; h: string; p: string }

const stage = document.querySelector<HTMLElement>('[data-circle]');
const cap = document.querySelector<HTMLElement>('[data-circle-cap]');
if (stage && cap) {
  const caps = JSON.parse(stage.dataset.caps ?? '[]') as Cap[];
  const k = cap.querySelector('.k') as HTMLElement, h = cap.querySelector('h1, h2') as HTMLElement, p = cap.querySelector('p') as HTMLElement;
  const dots = [...document.querySelectorAll<HTMLElement>('.circle-dots i')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let shown = 0, timer = 0;
  const show = (i: number): void => {
    if (i === shown) return;
    shown = i;
    dots.forEach((d, j) => d.classList.toggle('on', j === i));
    window.clearTimeout(timer);
    cap.classList.add('swap');
    timer = window.setTimeout(() => {
      const c = caps[i]!;
      k.textContent = c.k; h.textContent = c.h; p.textContent = c.p;
      cap.classList.remove('swap');
    }, reduced ? 0 : 260);
  };
  const gl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
  if (gl) {
    mountCircle(stage, {
      base: '/hero/', line: stage.dataset.line ?? '', reduced,
      onProgress: (v) => { let i = 0; caps.forEach((c, j) => { if (v >= c.at) i = j; }); show(i); },
    }).then(() => stage.querySelector('.circle-fallback')?.remove()).catch((e: unknown) => {
      stage.dataset.error = String((e as Error)?.message ?? e);
    });
  }
}
