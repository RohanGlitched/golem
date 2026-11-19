// Filmstrip: the eight frames around the worst moment of a counterexample.
export const FILMSTRIP_FRAMES = 8;
export const FILMSTRIP_HALF_WINDOW = 0.35;

export interface FilmstripEntry { frame: number; tau: number; isWorst: boolean }

export function filmstripFrames(worstTau: number, frameCount: number, fps: number): FilmstripEntry[] {
  const n = Math.max(1, Math.floor(frameCount));
  const T = n > 1 && fps > 0 ? (n - 1) / fps : 0;
  const w = Number.isFinite(worstTau) ? worstTau : 0;
  const out: FilmstripEntry[] = [];
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < FILMSTRIP_FRAMES; k++) {
    const raw = w - FILMSTRIP_HALF_WINDOW + (k * 2 * FILMSTRIP_HALF_WINDOW) / (FILMSTRIP_FRAMES - 1);
    const tau = raw < 0 ? 0 : raw > T ? T : raw;
    const frame = Math.min(n - 1, Math.max(0, Math.floor(tau * fps + 1e-9)));
    out.push({ frame, tau, isWorst: false });
    const d = Math.abs(tau - w);
    if (d < bestD) { bestD = d; best = k; }
  }
  (out[best] as FilmstripEntry).isWorst = true;
  return out;
}
