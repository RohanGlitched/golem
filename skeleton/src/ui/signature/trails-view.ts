// Trails_View: the long exposure on the stage. One LineSegments whose attributes are sized to the Trail_Store's
// capacity once; `rebuild` (once per generation) rewrites the used range and the draw range. Nothing per frame.
import type * as THREE_NS from 'three';
import { TrailStore } from '../core/trails.js';
import type { RGB } from '../core/trails.js';
import type { ThemeName, TokenSet } from '../types.js';

type Three = typeof THREE_NS;

export class TrailsView {
  readonly store: TrailStore;
  readonly lines: THREE_NS.LineSegments;
  private readonly geometry: THREE_NS.BufferGeometry;
  private readonly material: THREE_NS.LineBasicMaterial;
  private readonly pos: THREE_NS.BufferAttribute;
  private readonly col: THREE_NS.BufferAttribute;
  private held: RGB = [1, 1, 1];
  private brokenC: RGB = [1, 0, 0];
  private dirty = false;
  vertices = 0;

  constructor(private readonly T: Three, tokens: TokenSet, theme: ThemeName, store = new TrailStore()) {
    this.store = store;
    const n = store.maxVertices;
    this.geometry = new T.BufferGeometry();
    this.pos = new T.BufferAttribute(new Float32Array(3 * n), 3);
    this.col = new T.BufferAttribute(new Float32Array(3 * n), 3);
    this.pos.setUsage(T.DynamicDrawUsage);
    this.col.setUsage(T.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('color', this.col);
    this.geometry.setDrawRange(0, 0);
    this.material = new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, opacity: 0.5 });
    this.lines = new T.LineSegments(this.geometry, this.material);
    this.lines.name = 'golem-long-exposure';
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
    this.lines.visible = false;
    this.setTheme(tokens, theme);
  }

  get visible(): boolean { return this.lines.visible; }

  /** Shows or hides the trails; showing rebuilds when trials arrived while hidden. */
  setVisible(on: boolean): void {
    this.lines.visible = on;
    if (on && this.dirty) this.rebuild();
  }

  add(frames: Float32Array, nbody: number, body: number, broken: boolean): void {
    if (this.store.add(frames, nbody, body, broken)) this.dirty = true;
  }

  clear(): void {
    this.store.clear();
    this.vertices = 0;
    this.geometry.setDrawRange(0, 0);
    this.dirty = false;
  }

  /** Rewrites the merged geometry from the store. Skipped while hidden (done when shown). */
  rebuild(): void {
    if (!this.lines.visible) { this.dirty = this.dirty || this.store.count > 0; return; }
    const n = this.store.writeSegments(this.pos.array as Float32Array, this.col.array as Float32Array, this.held, this.brokenC);
    this.vertices = n;
    this.geometry.setDrawRange(0, n);
    for (const a of [this.pos, this.col]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, 3 * n);
      a.needsUpdate = true;
    }
    this.dirty = false;
  }

  setTheme(t: TokenSet, theme: ThemeName): void {
    const g = new this.T.Color(t.ghost), b = new this.T.Color(t.break);
    this.held = [g.r, g.g, g.b];
    this.brokenC = [b.r, b.g, b.b];
    // Light trails on the dark stage add up; on the daylight stage they are drawn as ink.
    this.material.blending = theme === 'dark' ? this.T.AdditiveBlending : this.T.NormalBlending;
    this.material.opacity = theme === 'dark' ? 0.45 : 0.6;
    this.material.needsUpdate = true;
    this.dirty = this.store.count > 0;
    if (this.lines.visible) this.rebuild();
  }

  dispose(): void {
    this.lines.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
