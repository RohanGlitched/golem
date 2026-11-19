// The interactive G1 stability map as an SVG: one wedge per push direction, its length the largest push survived.
import type { MapCell, MapSummary } from '../build/data';
import { esc, fmt, table } from '../build/html';
import { DEFAULT_SPEC, describeDirection, groupByDirection, polarPoint, radiusOf, wedgePath, weakestCell } from './polar';
import type { DirectionData, PolarSpec } from './polar';

export const PHASES = [0, 0.2, 0.4, 0.6, 0.8];

/** The data the browser needs to redraw wedges per stride phase. Small: 36 directions x 5 phases. */
export function polarPayload(dirs: DirectionData[], spec: PolarSpec = DEFAULT_SPEC): string {
  return JSON.stringify({ spec, dirs: dirs.map((d) => ({ d: d.dirDeg, m: Number(d.meanHeldN.toFixed(3)), c: d.cells.map((c) => [c.phase, c.heldN, c.brokeN]) })) });
}

export function polarSvg(dirs: DirectionData[], weakest: number, strongest: number, spec: PolarSpec = DEFAULT_SPEC): string {
  const rings = [100, 200, 300].map((n) => {
    const r = radiusOf(spec, n);
    return `<circle class="ring" cx="${spec.cx}" cy="${spec.cy}" r="${r.toFixed(1)}"/><text class="dim" x="${spec.cx + 4}" y="${(spec.cy - r - 3).toFixed(1)}">${n} N</text>`;
  }).join('');
  const axes = [0, 90, 180, 270].map((deg) => {
    const p = polarPoint(spec, deg, spec.maxN);
    const l = polarPoint({ ...spec, radius: spec.radius + 20 }, deg, spec.maxN);
    const anchor = deg === 90 ? 'start' : deg === 270 ? 'end' : 'middle';
    const dy = deg === 0 ? -4 : deg === 180 ? 14 : 4;
    return `<line class="axis" x1="${spec.cx}" y1="${spec.cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"/><text class="dim" text-anchor="${anchor}" x="${l.x.toFixed(1)}" y="${(l.y + dy).toFixed(1)}">${deg}°</text>`;
  }).join('');
  const wedges = dirs.map((d) => {
    const w = weakestCell(d);
    const held = w?.heldN ?? 0;
    const cls = d.dirDeg === weakest ? ' weak' : d.dirDeg === strongest ? ' strong' : '';
    return `<path class="wedge${cls}" data-dir="${d.dirDeg}" tabindex="0" role="img" aria-label="${esc(describeDirection(d))}" d="${wedgePath(spec, d.dirDeg, held)}"/>`;
  }).join('');
  const mean = dirs.map((d, i) => {
    const p = polarPoint(spec, d.dirDeg, d.meanHeldN);
    return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }).join('') + 'Z';
  const w = spec.cx * 2;
  const h = spec.cy + spec.radius + 64;
  const title = 'Stability map of the Unitree G1';
  const desc = `Polar plot. Each wedge is a push direction in 10 degree steps; its length is the largest 0.2 second pelvis push the G1 survived, from 0 to 300 N. The shortest wedge is ${weakest} degrees and the longest is ${strongest} degrees.`;
  return `<svg class="fig-svg" viewBox="0 0 ${w} ${h}" role="group" aria-labelledby="polar-t polar-d" data-polar-svg><title id="polar-t">${title}</title><desc id="polar-d">${esc(desc)}</desc>
<rect class="bg" width="${w}" height="${h}" fill-opacity="0"/>${rings}${axes}<path class="stroke-ghost" d="${mean}" stroke-width="1.25" stroke-dasharray="3 3"/>${wedges}
<text class="dim" x="${spec.cx}" y="${h - 6}" text-anchor="middle">Robot facing up. Angles clockwise from its heading.</text></svg>`;
}

export function polarFigure(cells: MapCell[], summary: MapSummary): string {
  const dirs = groupByDirection(cells);
  const m = summary.meta;
  const weakest = m.weakest.dirDeg;
  const strongest = m.strongest.dirDeg;
  const phaseBtns = [`<button type="button" class="btn small" data-phase="all" aria-pressed="true">Weakest phase</button>`]
    .concat(PHASES.map((p) => `<button type="button" class="btn small" data-phase="${p}" aria-pressed="false">Phase ${p}</button>`)).join('');
  const rows = dirs.map((d) => {
    const w = weakestCell(d)!;
    return [`${d.dirDeg}°`, w.heldN.toFixed(1), w.brokeN.toFixed(1), String(w.phase), d.meanHeldN.toFixed(1)];
  });
  const w0 = dirs.find((d) => d.dirDeg === weakest)!;
  return `<figure class="polar" data-polar='${esc(polarPayload(dirs))}'>
<div class="polar-wrap">
<div>${polarSvg(dirs, weakest, strongest)}</div>
<div>
<p class="polar-read" id="polar-read" aria-live="polite" data-default="${esc(describeDirection(w0))}"><b>Weakest direction.</b> ${esc(describeDirection(w0))}</p>
<div class="btn-row" role="group" aria-label="Stride phase shown">${phaseBtns}</div>
<p class="alt">Hover, tap or focus a wedge to read it. Arrow keys move between directions. The dashed line is the mean over phases and seeds. The red wedge is the weakest direction, the green one the strongest.</p>
</div></div>
<figcaption>Largest 0.2 s pelvis push the G1 survived for 3 s, per direction (${m.dirs} directions, ${m.phases} stride phases, ${m.seeds} seeds, ${m.cells} cells, ${m.trials.toLocaleString('en-US')} trials, force resolution 1.5625 N). Weakest: ${weakest}° at ${fmt(m.weakest.minHeldN)} N. Strongest: ${strongest}° at ${fmt(m.strongest.minHeldN)} N. Each trial is deterministic given its scenario and seed, so these are measured bounds, not estimates.</figcaption>
<details class="alt"><summary>The same data as a table</summary>${table(['Direction', 'Held (N)', 'Broke at (N)', 'Weakest phase', 'Mean held (N)'], rows, { num: [1, 2, 3, 4], caption: 'Weakest cell per direction, over stride phases and seeds' })}</details>
</figure>`;
}
