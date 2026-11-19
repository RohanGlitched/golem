// Filmstrip: the eight frames around the worst moment of a counterexample, rendered from one
// offscreen target of the Stage renderer, one frame per animation frame.
import type * as THREE_NS from 'three';
import { frameToTRS } from '../core/pose-math.js';

type Three = typeof THREE_NS;

export const FILMSTRIP_FRAMES = 8;
export const FILMSTRIP_HALF_WINDOW = 0.35;
export const FILM_W = 160;
export const FILM_H = 120;

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

/** "Frame at 0.35 s after the push: pelvis 0.31 m above the floor". */
export function frameLabel(tau: number, bodyName: string, z: number): string {
  return `Frame at ${tau.toFixed(2)} s after the push: ${bodyName} ${z.toFixed(2)} m above the floor`;
}

export interface FilmRenderer {
  render(scene: THREE_NS.Object3D, camera: THREE_NS.Camera): void;
  setRenderTarget?(t: THREE_NS.WebGLRenderTarget | null): void;
  getRenderTarget?(): THREE_NS.WebGLRenderTarget | null;
  readRenderTargetPixels?(t: THREE_NS.WebGLRenderTarget, x: number, y: number, w: number, h: number, buf: Uint8Array): void;
}

export interface FilmstripDeps {
  THREE: Three;
  renderer: FilmRenderer;
  scene: THREE_NS.Scene;
  mainCamera: THREE_NS.PerspectiveCamera;
  bodyGroups: THREE_NS.Object3D[];
  /** Ghosts, aura and live arrows: hidden while a film frame renders. */
  hide: THREE_NS.Object3D[];
  /** Puts the live hero pose back on the body groups. */
  restoreLive(): void;
  raf(cb: (ts: number) => void): number;
  caf(id: number): void;
  /** Point the private camera looks at, per frame (usually the primary push body). */
  focusBody: number;
}

/** One reused render target and pixel buffer for all filmstrips of a studio. */
export class FilmstripRenderer {
  private target: THREE_NS.WebGLRenderTarget | undefined;
  private readonly pixels = new Uint8Array(FILM_W * FILM_H * 4);
  private readonly cam: THREE_NS.PerspectiveCamera;
  private readonly trs = new Float64Array(7);

  constructor(private readonly d: FilmstripDeps) {
    this.cam = new d.THREE.PerspectiveCamera(40, FILM_W / FILM_H, 0.02, 80);
    this.cam.up.set(0, 0, 1);
  }

  private ensureTarget(): THREE_NS.WebGLRenderTarget {
    if (!this.target) {
      this.target = new this.d.THREE.WebGLRenderTarget(FILM_W, FILM_H, { samples: 0 });
      this.target.texture.colorSpace = this.d.THREE.SRGBColorSpace;
    }
    return this.target;
  }

  /** Renders one entry into a canvas, synchronously: pose, render, read back, restore. */
  renderOne(frames: Float32Array, nbody: number, frame: number, canvas: HTMLCanvasElement | { getContext(t: '2d'): CanvasRenderingContext2D | null; width: number; height: number }): void {
    const { THREE: T, renderer, scene, bodyGroups, hide } = this.d;
    for (let b = 0; b < nbody && b < bodyGroups.length; b++) {
      frameToTRS(frames, nbody, frame, b, this.trs);
      const g = bodyGroups[b] as THREE_NS.Object3D;
      g.position.set(this.trs[0] as number, this.trs[1] as number, this.trs[2] as number);
      g.quaternion.set(this.trs[3] as number, this.trs[4] as number, this.trs[5] as number, this.trs[6] as number);
    }
    const vis = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const fb = Math.min(this.d.focusBody, nbody - 1);
    const o = (frame * nbody + Math.max(0, fb)) * 7;
    const focus = new T.Vector3(frames[o] ?? 0, frames[o + 1] ?? 0, Math.max(0.2, (frames[o + 2] ?? 0) * 0.8));
    const main = this.d.mainCamera;
    const off = main.getWorldDirection(new T.Vector3()).negate();
    this.cam.fov = main.fov;
    this.cam.position.copy(focus).addScaledVector(off.lengthSq() > 0 ? off : new T.Vector3(1, -1, 0.5).normalize(), 2.4);
    this.cam.lookAt(focus);
    this.cam.updateProjectionMatrix();
    const target = this.ensureTarget();
    const prev = renderer.getRenderTarget?.() ?? null;
    renderer.setRenderTarget?.(target);
    renderer.render(scene, this.cam);
    renderer.readRenderTargetPixels?.(target, 0, 0, FILM_W, FILM_H, this.pixels);
    renderer.setRenderTarget?.(prev);
    hide.forEach((h, i) => { h.visible = vis[i] as boolean; });
    this.d.restoreLive();
    const ctx = canvas.getContext('2d');
    if (ctx && typeof ImageData !== 'undefined') {
      const img = new ImageData(FILM_W, FILM_H);
      const row = FILM_W * 4;
      for (let y = 0; y < FILM_H; y++) img.data.set(this.pixels.subarray((FILM_H - 1 - y) * row, (FILM_H - y) * row), y * row);
      canvas.width = FILM_W; canvas.height = FILM_H;
      ctx.putImageData(img, 0, 0);
    }
  }

  /** Renders the entries one per animation frame. Returns an abort function. */
  start(frames: Float32Array, nbody: number, entries: FilmstripEntry[], canvases: (HTMLCanvasElement | null)[], onDone?: () => void): () => void {
    let k = 0;
    let id = 0;
    let aborted = false;
    const step = (): void => {
      id = 0;
      if (aborted) return;
      const e = entries[k];
      const c = canvases[k];
      if (e && c) this.renderOne(frames, nbody, e.frame, c);
      k++;
      if (k < entries.length) id = this.d.raf(step);
      else onDone?.();
    };
    id = this.d.raf(step);
    return () => { aborted = true; if (id) this.d.caf(id); id = 0; };
  }

  dispose(): void { this.target?.dispose(); this.target = undefined; }
}
