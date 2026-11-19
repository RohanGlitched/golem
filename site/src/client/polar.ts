// Interactivity of the G1 stability map: hover, focus and tap read a direction; the buttons redraw per stride phase.
import { describeDirection, wedgePath, weakestCell } from '../figures/polar';
import type { DirectionData, PolarSpec } from '../figures/polar';

interface Payload { spec: PolarSpec; dirs: { d: number; m: number; c: [number, number, number][] }[] }

const fig = document.querySelector<HTMLElement>('[data-polar]');
if (fig) {
  const payload = JSON.parse(fig.dataset['polar'] as string) as Payload;
  const dirs: DirectionData[] = payload.dirs.map((x) => ({
    dirDeg: x.d, meanHeldN: x.m, cells: x.c.map(([phase, heldN, brokeN]) => ({ phase, heldN, brokeN })),
  }));
  const wedges = Array.from(fig.querySelectorAll<SVGPathElement>('.wedge'));
  const read = fig.querySelector<HTMLElement>('#polar-read') as HTMLElement;
  const dflt = read.innerHTML;
  let phase: number | undefined;

  const byDir = (el: Element): DirectionData | undefined => dirs.find((d) => d.dirDeg === Number((el as HTMLElement).dataset['dir']));
  const show = (el: Element): void => {
    const d = byDir(el);
    if (!d) return;
    wedges.forEach((w) => w.classList.toggle('on', w === el));
    read.innerHTML = `<b>Direction ${d.dirDeg}°.</b> ${describeDirection(d, phase).replace(/^\d+°: /, '')}`;
  };
  const reset = (): void => { wedges.forEach((w) => w.classList.remove('on')); read.innerHTML = phase === undefined ? dflt : `<b>Stride phase ${phase}.</b> Hover or focus a wedge.`; };

  const redraw = (): void => {
    for (const w of wedges) {
      const d = byDir(w);
      if (!d) continue;
      const cell = weakestCell(d, phase);
      w.setAttribute('d', wedgePath(payload.spec, d.dirDeg, cell?.heldN ?? 0));
      w.setAttribute('aria-label', describeDirection(d, phase));
    }
    reset();
  };

  wedges.forEach((w, i) => {
    w.addEventListener('pointerover', () => show(w));
    w.addEventListener('focus', () => show(w));
    w.addEventListener('click', () => show(w));
    w.addEventListener('blur', reset);
    w.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      wedges[(i + step + wedges.length) % wedges.length]?.focus();
    });
  });
  fig.querySelector('svg')?.addEventListener('pointerleave', reset);

  fig.querySelectorAll<HTMLButtonElement>('[data-phase]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset['phase'];
      phase = v === 'all' ? undefined : Number(v);
      fig.querySelectorAll<HTMLButtonElement>('[data-phase]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      wedges.forEach((w) => {
        const d = byDir(w) as DirectionData;
        const weakest = dirs.reduce((m, x) => ((weakestCell(x)?.heldN ?? 0) < (weakestCell(m)?.heldN ?? Infinity) ? x : m), dirs[0] as DirectionData);
        const strongest = dirs.reduce((m, x) => ((weakestCell(x)?.heldN ?? 0) > (weakestCell(m)?.heldN ?? 0) ? x : m), dirs[0] as DirectionData);
        w.classList.toggle('weak', phase === undefined && d === weakest);
        w.classList.toggle('strong', phase === undefined && d === strongest);
      });
      redraw();
    });
  });
}
