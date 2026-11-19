// The six small figures of "How it works". Each is drawn from committed data, never invented.
import type { LexiconRef, MapCell } from '../build/data';
import { esc } from '../build/html';
import { groupByDirection, weakestCell } from './polar';

const W = 320;
const H = 180;

function svg(id: string, title: string, desc: string, inner: string): string {
  return `<svg class="fig-svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-t ${id}-d"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>${inner}</svg>`;
}

/** The eight halvings the map script applies to [0, fmax] N around a cell whose boundary is `heldN`. */
export function bisection(heldN: number, fmax = 400, steps = 8): { n: number; forceN: number; held: boolean }[] {
  let lo = 0;
  let hi = fmax;
  const out: { n: number; forceN: number; held: boolean }[] = [];
  for (let n = 1; n <= steps; n++) {
    const mid = (lo + hi) / 2;
    const held = mid <= heldN;
    out.push({ n, forceN: mid, held });
    if (held) lo = mid; else hi = mid;
  }
  return out;
}

const deg = (rad: number): number => (rad * 180) / Math.PI;

/** 1. The EARS line, set as the studio sets it: quantities underlined. */
export function earsFigure(line: string): string {
  const q = (s: string): string => `<tspan class="fill-ghost" text-decoration="underline">${esc(s)}</tspan>`;
  const kw = (s: string): string => `<tspan class="dim" font-size="10" letter-spacing="0.4">${s}</tspan>`;
  void line;
  return svg('p1', 'An EARS requirement', `The requirement as written: ${line}`, `
<rect class="bg" x="4" y="14" width="${W - 8}" height="${H - 28}" rx="2" stroke="var(--rule)"/>
<text x="16" y="52">${kw('WHEN')} the pelvis is pushed with up to ${q('250 N')}</text>
<text x="16" y="76">for ${q('0.2 s')} from behind at any point in its stride</text>
<text x="16" y="108">${kw('THE')} robot ${kw('SHALL')} stay upright for ${q('3 s')}</text>
<text class="dim" x="16" y="146" font-size="11">Line 1.2 of the G1 spec. Underlined: numbers the</text>
<text class="dim" x="16" y="161" font-size="11">studio lets you drag, and the search varies.</text>`);
}

/** 2. The scenario space and the monitor, from the compiled line. */
export function spaceFigure(line: LexiconRef['lines'][number]): string {
  const rows = line.dims.map((d, i) => {
    const y = 38 + i * 30;
    const toText = (v: number): string => (d.kind === 'angle' ? `${Math.round(deg(v))}°` : d.kind === 'force' ? `${v} N` : String(v));
    const unit = d.kind === 'angle' ? 2 * Math.PI : d.kind === 'phase' ? 1 : d.max;
    const x0 = 118 + (d.min / unit) * 150;
    const x1 = 118 + (d.max / unit) * 150;
    return `<text x="8" y="${y + 4}" class="mono" font-size="11">${esc(d.name)}</text><line class="stroke-clay" x1="118" y1="${y}" x2="268" y2="${y}" stroke-opacity=".4"/><rect class="fill-ghost" x="${x0.toFixed(1)}" y="${y - 5}" width="${Math.max(3, x1 - x0).toFixed(1)}" height="10"/><text class="dim mono" x="274" y="${y + 4}" font-size="10">${esc(toText(d.min))}–${esc(toText(d.max))}</text>`;
  }).join('');
  return svg('p2', 'The scenario space and the monitor', `The compiler turns the line into ${line.dims.length} searched dimensions (${line.dims.map((d) => d.name).join(', ')}) and a monitor with the formula ${line.formula ?? ''}.`, `
${rows}
<text class="dim" x="8" y="${38 + line.dims.length * 30 + 4}" font-size="11">Monitor, positive means it held:</text>
<text class="mono" x="8" y="${38 + line.dims.length * 30 + 22}" font-size="11">${esc(line.formula ?? '')}</text>`);
}

/** 3. Ghosts: every measured boundary is a pile of trials that held (below) and broke (above). */
export function ghostFigure(cells: MapCell[]): string {
  const dirs = groupByDirection(cells);
  const x = (d: number): number => 14 + (d / 360) * 292;
  const y = (n: number): number => 156 - (n / 400) * 134;
  const held = dirs.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(d.dirDeg).toFixed(1)} ${y(weakestCell(d)!.heldN).toFixed(1)}`).join('');
  const dots = cells.map((c) => `<circle cx="${x(c.dirDeg).toFixed(1)}" cy="${y(c.heldN).toFixed(1)}" r="1.4" class="fill-ghost" fill-opacity=".35"/>`).join('');
  const broke = dirs.map((d) => `<circle cx="${x(d.dirDeg).toFixed(1)}" cy="${y(weakestCell(d)!.brokeN).toFixed(1)}" r="2.6" class="fill-break"/>`).join('');
  return svg('p3', 'Ghosts below and above the boundary', 'Force against push direction. Pale dots are the largest pushes that held in each of 540 cells; cinnabar dots are the smallest push that broke the weakest cell of each direction.', `
<line class="stroke-clay" x1="14" y1="156" x2="306" y2="156" stroke-opacity=".5"/>${dots}<path class="stroke-ghost" d="${held}" stroke-width="1"/>${broke}
<text class="dim" x="14" y="174" font-size="10">0°</text><text class="dim" x="296" y="174" font-size="10">350°</text><text class="dim" x="14" y="16" font-size="10">400 N</text>`);
}

/** 4. Shrink: the halving that closes in on the mildest push that still breaks the weakest cell. */
export function shrinkFigure(heldN: number, brokeN: number, dirDeg: number): string {
  const steps = bisection(heldN);
  const x = (n: number): number => 16 + (n / 400) * 288;
  const rows = steps.map((s, i) => {
    const yy = 22 + i * 17;
    return `<circle cx="${x(s.forceN).toFixed(1)}" cy="${yy}" r="4" class="${s.held ? 'fill-ghost' : 'fill-break'}"/><text class="dim mono" x="${(x(s.forceN) + (s.forceN > 300 ? -8 : 8)).toFixed(1)}" y="${yy + 4}" font-size="10" text-anchor="${s.forceN > 300 ? 'end' : 'start'}">${s.forceN % 1 ? s.forceN.toFixed(2) : s.forceN} N</text>`;
  }).join('');
  return svg('p4', 'Shrinking to the mildest failing push', `Eight halvings of the range 0 to 400 N on the weakest cell, direction ${dirDeg} degrees. Pale: held. Cinnabar: broke. The boundary closes to between ${heldN} N and ${brokeN} N.`, `
<line class="stroke-clay" x1="16" y1="8" x2="16" y2="${H - 8}" stroke-opacity=".5"/>${rows}
<text class="dim" x="16" y="${H - 2}" font-size="10">0 N</text><text class="dim" x="304" y="${H - 2}" font-size="10" text-anchor="end">400 N</text>`);
}

/** 5. The pinned seed: the committed counterexample file. */
export function seedFigure(seed: { reqId: string; scenario: Record<string, number>; seed: number; robustness: number }, file: string): string {
  const sc = seed.scenario;
  const lines = [
    `{ "reqId": "${seed.reqId}",`,
    `  "push.force": ${(sc['push.force'] as number).toFixed(1)},   // N`,
    `  "push.angle": ${deg(sc['push.angle'] as number).toFixed(0)},      // deg`,
    `  "push.phase": ${(sc['push.phase'] as number).toFixed(3)},    // stride`,
    `  "seed": ${seed.seed},`,
    `  "robustness": ${seed.robustness} }  // m`,
  ];
  return svg('p5', 'A pinned counterexample', `The committed seed file ${file}: ${lines.join(' ').replace(/\s+/g, ' ')}`, `
<rect class="bg" x="4" y="10" width="${W - 8}" height="${H - 20}" rx="2" stroke="var(--rule)"/>
${lines.map((l, i) => `<text class="mono" x="14" y="${34 + i * 17}" font-size="11">${esc(l)}</text>`).join('')}
<text class="dim" x="14" y="${H - 18}" font-size="10">${esc(file)}</text>`);
}

/** 6. The Stop gate: the verbatim last line of `golem gate` and the exit code. */
export function gateFigure(gateLine: string, firstBlock: string[]): string {
  return svg('p6', 'The Stop gate', `golem gate printed: ${gateLine}. It exits with code 2, so the Kiro Stop hook blocks the agent from finishing.`, `
<rect class="bg" x="4" y="10" width="${W - 8}" height="${H - 20}" rx="2" stroke="var(--rule)"/>
<text class="mono" x="14" y="32" font-size="11">$ golem gate</text>
${firstBlock.map((l, i) => `<text class="dim mono" x="14" y="${54 + i * 15}" font-size="10">${esc(l)}</text>`).join('')}
<text class="mono fill-break" x="14" y="118" font-size="12">${esc(gateLine)}</text>
<text class="mono" x="14" y="142" font-size="11">exit code 2</text>
<text class="dim" x="14" y="160" font-size="11">The Stop hook blocks “done” until it is 0.</text>`);
}
