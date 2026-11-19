// Drag: carry a mocap body (for example a trick-or-treater's hand) with the pointer. The body stays on the horizontal plane
// it had when it was grabbed, and the app's `constrain` decides where on that plane it may go. Nothing is applied as a force:
// the mocap row is written, and the live controller sees the body where the pointer put it.
import type * as THREE_NS from 'three';
import { rayPlane } from '../core/spring.js';
import type { V3 } from '../types.js';
import type { HeroSim } from './hero-sim.js';
import type { Ray } from './shove.js';

type Three = typeof THREE_NS;

export interface DragDeps {
  THREE: Three;
  canvas: HTMLElement;
  camera: THREE_NS.PerspectiveCamera;
  hero: HeroSim;
  /** Meshes of the dragged body only (those with `userData.bodyId === body`). */
  meshes: THREE_NS.Object3D[];
  /** Row of the body in `mocap_pos`. */
  mocapRow: number;
  scheduler: { acquire(r: 'dragging'): void; release(r: 'dragging'): void; requestOnce(): void };
  announce(msg: string): void;
  /** Words for the announcement when the drag ends, e.g. "hand". */
  noun: string;
  /** The app's rule for where the body may go. Default: anywhere on the plane. */
  constrain?(p: V3): V3;
  /** Test seams. */
  hit?(e: { clientX: number; clientY: number }): boolean;
  ray?(e: { clientX: number; clientY: number }): Ray;
}

export class DragController {
  disabled = false;
  private pointerId: number | undefined;
  private plane = 0;
  private offX = 0;
  private offY = 0;
  private readonly pos = new Float64Array(3);
  private readonly raycaster: THREE_NS.Raycaster;
  private readonly ndc: THREE_NS.Vector2;
  private readonly listeners: [string, EventListener, AddEventListenerOptions?][] = [];

  constructor(private readonly d: DragDeps) {
    this.raycaster = new d.THREE.Raycaster();
    this.ndc = new d.THREE.Vector2();
    this.on('pointerdown', (e) => this.down(e as PointerEvent));
    this.on('pointermove', (e) => this.move(e as PointerEvent));
    this.on('pointerup', (e) => this.up(e as PointerEvent));
    this.on('pointercancel', (e) => this.up(e as PointerEvent));
    this.on('touchstart', (e) => {
      const t = (e as TouchEvent).touches[0];
      if (t && this.isOnBody(t)) e.preventDefault();
    }, { passive: false });
    this.on('touchmove', (e) => { if (this.pointerId !== undefined) e.preventDefault(); }, { passive: false });
  }

  private on(type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    this.d.canvas.addEventListener(type, fn, opts);
    this.listeners.push([type, fn, opts]);
  }

  private rayOf(e: { clientX: number; clientY: number }): Ray {
    if (this.d.ray) return this.d.ray(e);
    const r = this.d.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.d.camera);
    const o = this.raycaster.ray.origin, dd = this.raycaster.ray.direction;
    return { origin: [o.x, o.y, o.z], dir: [dd.x, dd.y, dd.z] };
  }

  /** True when the pointer is over the dragged body. */
  isOnBody(e: { clientX: number; clientY: number }): boolean {
    if (this.disabled) return false;
    if (this.d.hit) return this.d.hit(e);
    const ray = this.rayOf(e);
    this.raycaster.ray.origin.set(ray.origin[0], ray.origin[1], ray.origin[2]);
    this.raycaster.ray.direction.set(ray.dir[0], ray.dir[1], ray.dir[2]);
    return this.raycaster.intersectObjects(this.d.meshes, false).length > 0;
  }

  get active(): boolean { return this.pointerId !== undefined; }

  /** Point of the plane under the pointer, or undefined when the ray is parallel to it or points away. */
  private planePoint(e: { clientX: number; clientY: number }): V3 | undefined {
    const ray = this.rayOf(e);
    return rayPlane(ray.origin, ray.dir, [0, 0, this.plane], [0, 0, 1]) ?? undefined;
  }

  down(e: { pointerId: number; clientX: number; clientY: number; button?: number }): void {
    if (this.disabled || this.pointerId !== undefined) return;
    if (e.button !== undefined && e.button > 0) return;
    if (!this.isOnBody(e)) return;
    this.d.hero.mocapPos(this.d.mocapRow, this.pos);
    this.plane = this.pos[2] as number;
    const p = this.planePoint(e);
    // Keep the grab point: the hand does not jump to the pointer.
    this.offX = p ? (this.pos[0] as number) - p[0] : 0;
    this.offY = p ? (this.pos[1] as number) - p[1] : 0;
    this.pointerId = e.pointerId;
    try { (this.d.canvas as HTMLElement & { setPointerCapture?(id: number): void }).setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
    this.d.canvas.style.touchAction = 'none';
    this.d.scheduler.acquire('dragging');
    this.d.hero.wake();
  }

  move(e: { pointerId: number; clientX: number; clientY: number }): void {
    if (e.pointerId !== this.pointerId) return;
    const p = this.planePoint(e);
    if (!p) return;
    const want: V3 = [p[0] + this.offX, p[1] + this.offY, this.plane];
    const to = this.d.constrain ? this.d.constrain(want) : want;
    this.d.hero.setMocapPos(this.d.mocapRow, to[0], to[1], to[2]);
    this.d.scheduler.requestOnce();
  }

  up(e: { pointerId: number }): void {
    if (e.pointerId !== this.pointerId) return;
    this.end();
    this.d.hero.mocapPos(this.d.mocapRow, this.pos);
    const [x, y, z] = [this.pos[0] as number, this.pos[1] as number, this.pos[2] as number];
    this.d.announce(`Moved the ${this.d.noun} to x ${x.toFixed(2)} m, y ${y.toFixed(2)} m, z ${z.toFixed(2)} m`);
  }

  private end(): void {
    if (this.pointerId === undefined) return;
    this.pointerId = undefined;
    this.d.canvas.style.touchAction = '';
    this.d.scheduler.release('dragging');
  }

  /** Escape or a replay: ends a drag without an announcement. The body stays where it is. */
  cancel(): void { this.end(); }

  dispose(): void {
    this.cancel();
    for (const [t, fn, o] of this.listeners) this.d.canvas.removeEventListener(t, fn, o);
  }
}
