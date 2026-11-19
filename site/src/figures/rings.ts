// The before / after rings on the home page: the G1's measured push boundary in every direction, drawn like the
// hero's floor inscription. The sentence is written around the ring; it cracks red over every direction where
// the robot does not survive the line's force. Angles follow push.angle: counterclockwise from the heading.
import type { MapDirection } from '../build/data';
import { esc, fmt } from '../build/html';

export interface RingStats { holding: number; dirs: number; weakest: MapDirection; strongest: MapDirection; meanMin: number }

const CX = 220, CY = 220, R_MAX = 150, MAX_N = 300, R_TEXT = 196;
const rad = (deg: number): number => ((-deg - 90) * Math.PI) / 180;
const pt = (deg: number, r: number): [number, number] => [CX + r * Math.cos(rad(deg)), CY + r * Math.sin(rad(deg))];
const rOf = (n: number): number => (Math.max(0, Math.min(n, MAX_N)) / MAX_N) * R_MAX;
const f = (n: number): string => n.toFixed(1);

/** The side a push comes from, in words (0 front, 90 left, 180 behind, 270 right). */
export function sideName(deg: number): string {
  const names = ['the front', 'the front left', 'the left', 'behind on the left', 'behind', 'behind on the right', 'the right', 'the front right'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

export function ringStats(summary: MapDirection[], lineN: number): RingStats {
  const sorted = [...summary].sort((a, b) => a.minHeldN - b.minHeldN);
  return {
    holding: summary.filter((d) => d.minHeldN >= lineN).length,
    dirs: summary.length,
    weakest: sorted[0]!,
    strongest: sorted[sorted.length - 1]!,
    meanMin: summary.reduce((s, d) => s + d.minHeldN, 0) / summary.length,
  };
}

function arc(r: number, a0: number, a1: number): string {
  // counterclockwise on screen from a0 to a1 (degrees in push.angle terms)
  const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${f(x0)} ${f(y0)}A${r} ${r} 0 ${large} 0 ${f(x1)} ${f(y1)}`;
}

export function ringSvg(summary: MapDirection[], o: { id: string; line: string; lineN: number; after?: boolean; label: string }): string {
  const s = [...summary].sort((a, b) => a.dirDeg - b.dirDeg);
  const step = s.length > 1 ? s[1]!.dirDeg - s[0]!.dirDeg : 10;
  const bound = s.map((d, i) => { const [x, y] = pt(d.dirDeg, rOf(d.minHeldN)); return `${i ? 'L' : 'M'}${f(x)} ${f(y)}`; }).join('') + 'Z';
  // where the robot does not survive the line's force: a red band over the sentence and a fissure from the boundary out through it
  const cracks = s.filter((d) => d.minHeldN < o.lineN).map((d, j) => {
    const zig = Array.from({ length: 9 }, (_, i) => {
      const r = rOf(d.minHeldN) + ((R_TEXT + 12 - rOf(d.minHeldN)) * i) / 8;
      const [x, y] = pt(d.dirDeg + Math.sin(i * 2.1 + j) * 2.2, r);
      return `${i ? 'L' : 'M'}${f(x)} ${f(y)}`;
    }).join('');
    return `<path class="crack-band" d="${arc(R_TEXT - 5, d.dirDeg - step / 2, d.dirDeg + step / 2)}"/><path class="crack-line" d="${zig}"/>`;
  }).join('');
  const st = ringStats(s, o.lineN);
  const [wx, wy] = pt(st.weakest.dirDeg, rOf(st.weakest.minHeldN));
  const [lx, ly] = pt(st.weakest.dirDeg, R_TEXT - 64);
  const [kx, ky] = pt(st.weakest.dirDeg, R_TEXT - 84);
  const refs = [100, 200, 300].map((n) => `<circle class="ref" cx="${CX}" cy="${CY}" r="${f(rOf(n))}"/>`).join('')
    + `<circle class="ref line" cx="${CX}" cy="${CY}" r="${f(rOf(o.lineN))}"/><text class="reflab" x="${CX + 4}" y="${f(CY - rOf(o.lineN) - 4)}">${o.lineN} N</text>`;
  // text runs clockwise along a circle starting at the top, so it reads left to right over the robot's head
  const textPath = `M${CX} ${CY - R_TEXT}A${R_TEXT} ${R_TEXT} 0 1 1 ${CX - 0.01} ${CY - R_TEXT}`;
  const desc = `${o.label}. Polar outline of the largest 0.2 s pelvis push survived in each of ${st.dirs} directions, robot facing up, angles counterclockwise. It survives ${o.lineN} N from ${st.holding} of ${st.dirs} directions. Weakest: ${fmt(st.weakest.minHeldN)} N from ${sideName(st.weakest.dirDeg)} (${st.weakest.dirDeg} degrees).`;
  return `<svg class="ring-svg" viewBox="0 0 440 440" role="img" aria-labelledby="${o.id}-t ${o.id}-d"><title id="${o.id}-t">${esc(o.label)}</title><desc id="${o.id}-d">${esc(desc)}</desc>
<defs><path id="${o.id}-p" d="${textPath}"/></defs>
<text class="ring-text"><textPath href="#${o.id}-p" startOffset="0" textLength="${f(2 * Math.PI * R_TEXT - 24)}" lengthAdjust="spacing">${esc(o.line.toUpperCase())}</textPath></text>
${cracks}${refs}
<path class="bound${o.after ? ' after' : ''}" d="${bound}"/>
<path class="leader" d="M${f(wx)} ${f(wy)}L${f(kx)} ${f(ky)}"/><circle class="weak" cx="${f(wx)}" cy="${f(wy)}" r="4.5"/><text class="weak-lab" x="${f(lx)}" y="${f(ly + 4)}" text-anchor="middle">${fmt(st.weakest.minHeldN)} N</text>
<g class="robot" transform="translate(${CX} ${CY})"><circle r="7"/><path d="M0 -15L5 -6H-5Z"/></g>
</svg>`;
}
