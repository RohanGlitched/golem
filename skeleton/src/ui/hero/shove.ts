// Shove: grab a body with the pointer (spring force, capped at 400 N) or push it with the arrow keys
// (100 N for 0.2 s). Both draw the same arrow and live label. Forces go through xfrc_applied each step.
import type * as THREE_NS from 'three';
import { FORCE_CAP, KEY_PUSH_FORCE, directionName, keyPushDirection, keyPushSteps, rayPlane, shovePlaneNormal } from '../core/spring.js';
import type { ArrowKey } from '../core/spring.js';
import { quatRotateWXYZ } from '../core/pose-math.js';
import type { V3 } from '../types.js';
import type { HeroSim, HeroViews } from './hero-sim.js';

type Three = typeof THREE_NS;

export interface Pick { body: number; point: V3 }
export interface Ray { origin: V3; dir: V3 }

export interface ShoveDeps {
  THREE: Three;
  canvas: HTMLElement;
  camera: THREE_NS.PerspectiveCamera;
  scene: THREE_NS.Scene;
  hero: HeroSim;
  /** Body groups of the stage, for world-to-local of the grab point. */
  bodyGroups: THREE_NS.Object3D[];
  meshes: THREE_NS.Object3D[];
  scheduler: { acquire(r: 'dragging'): void; release(r: 'dragging'): void; requestOnce(): void };
  announce(msg: string): void;
  stiffness: number;
  primaryBody: number;
  simDt: number;
  /** Shift + arrow goes to the orbit. */
  orbitKey?(e: KeyboardEvent): boolean;
  inkColor: string;
  /** Test seams. */
  pick?(e: { clientX: number; clientY: number }): Pick | undefined;
  ray?(e: { clientX: number; clientY: number }): Ray;
}

const ARROW_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class ShoveController {
  /** Live label text, e.g. "168 N", or '' when no push is active. */
  label = '';
  readonly labelEl: HTMLDivElement;
  readonly arrow: THREE_NS.Group;
  private readonly arrowMat: THREE_NS.MeshBasicMaterial;
  private readonly shaft: THREE_NS.Mesh;
  private readonly head: THREE_NS.Mesh;
  private pointerId: number | undefined;
  private body = -1;
  private readonly gLocal = new Float64Array(3);
  private readonly gWorld = new Float64Array(3);
  private readonly target = new Float64Array(3);
  private readonly scratch = new Float64Array(3);
  private force = 0;
  private peak = 0;
  private keySteps = 0;
  private keyDir: V3 = [0, 0, 0];
  private keyName: ArrowKey | undefined;
  private dragging = false;
  private previewBody = -1;
  private readonly previewDir = new Float64Array(3);
  private previewForce = 0;
  private previewLength = 0;
  private readonly raycaster: THREE_NS.Raycaster;
  private readonly ndc: THREE_NS.Vector2;
  private readonly listeners: [string, EventListener, AddEventListenerOptions?][] = [];
  disabled = false;

  constructor(private readonly d: ShoveDeps) {
    const T = d.THREE;
    this.raycaster = new T.Raycaster();
    this.ndc = new T.Vector2();
    this.arrowMat = new T.MeshBasicMaterial({ color: new T.Color(d.inkColor), depthTest: false, transparent: true, opacity: 0.9 });
    this.shaft = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 1, 8).translate(0, 0.5, 0), this.arrowMat);
    this.head = new T.Mesh(new T.ConeGeometry(0.025, 0.07, 12).translate(0, -0.035, 0), this.arrowMat);
    this.arrow = new T.Group();
    this.arrow.add(this.shaft, this.head);
    this.arrow.visible = false;
    this.arrow.renderOrder = 20;
    d.scene.add(this.arrow);
    const doc = d.canvas.ownerDocument;
    this.labelEl = doc.createElement('div');
    this.labelEl.className = 'golem-shove-label golem-num';
    this.labelEl.setAttribute('aria-hidden', 'true');
    this.labelEl.hidden = true;
    d.canvas.parentElement?.appendChild(this.labelEl);

    this.on('pointerdown', (e) => this.down(e as PointerEvent));
    this.on('pointermove', (e) => this.move(e as PointerEvent));
    this.on('pointerup', (e) => this.up(e as PointerEvent));
    this.on('pointercancel', (e) => this.up(e as PointerEvent));
    this.on('keydown', (e) => this.key(e as KeyboardEvent));
    const stopTouch = (e: Event): void => { if (this.pointerId !== undefined) e.preventDefault(); };
    this.on('touchstart', (e) => {
      const t = (e as TouchEvent).touches[0];
      if (t && this.isOnBody(t)) e.preventDefault();
    }, { passive: false });
    this.on('touchmove', stopTouch, { passive: false });
  }

  private on(type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    this.d.canvas.addEventListener(type, fn, opts);
    this.listeners.push([type, fn, opts]);
  }

  setInk(color: string): void { this.arrowMat.color.set(color); }

  private rayOf(e: { clientX: number; clientY: number }): Ray {
    if (this.d.ray) return this.d.ray(e);
    const r = this.d.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.d.camera);
    const o = this.raycaster.ray.origin, dd = this.raycaster.ray.direction;
    return { origin: [o.x, o.y, o.z], dir: [dd.x, dd.y, dd.z] };
  }

  private pickAt(e: { clientX: number; clientY: number }): Pick | undefined {
    if (this.d.pick) return this.d.pick(e);
    const ray = this.rayOf(e);
    this.raycaster.ray.origin.set(ray.origin[0], ray.origin[1], ray.origin[2]);
    this.raycaster.ray.direction.set(ray.dir[0], ray.dir[1], ray.dir[2]);
    const hit = this.raycaster.intersectObjects(this.d.meshes, false)[0];
    if (!hit) return undefined;
    const body = hit.object.userData['bodyId'] as number | undefined;
    if (body === undefined) return undefined;
    return { body, point: [hit.point.x, hit.point.y, hit.point.z] };
  }

  isOnBody(e: { clientX: number; clientY: number }): boolean {
    return !this.disabled && this.pickAt(e) !== undefined;
  }

  private camDir(): V3 {
    const v = new this.d.THREE.Vector3();
    this.d.camera.getWorldDirection(v);
    return [v.x, v.y, v.z];
  }

  private worldGrab(v: HeroViews): void {
    const b = this.body;
    quatRotateWXYZ(v.xquat[4 * b] as number, v.xquat[4 * b + 1] as number, v.xquat[4 * b + 2] as number, v.xquat[4 * b + 3] as number,
      this.gLocal[0] as number, this.gLocal[1] as number, this.gLocal[2] as number, this.scratch);
    this.gWorld[0] = (v.xpos[3 * b] as number) + (this.scratch[0] as number);
    this.gWorld[1] = (v.xpos[3 * b + 1] as number) + (this.scratch[1] as number);
    this.gWorld[2] = (v.xpos[3 * b + 2] as number) + (this.scratch[2] as number);
  }

  /** Per physics step: spring force at the grab point and its torque about the centre of mass. No allocation. */
  private readonly shoveStep = (v: HeroViews): boolean => {
    if (this.pointerId === undefined) return false;
    this.worldGrab(v);
    const k = this.d.stiffness;
    let fx = k * ((this.target[0] as number) - (this.gWorld[0] as number));
    let fy = k * ((this.target[1] as number) - (this.gWorld[1] as number));
    let fz = k * ((this.target[2] as number) - (this.gWorld[2] as number));
    const m = Math.hypot(fx, fy, fz);
    if (m > FORCE_CAP) { const s = FORCE_CAP / m; fx *= s; fy *= s; fz *= s; }
    const b = this.body, o = 6 * b;
    const rx = (this.gWorld[0] as number) - (v.xipos[3 * b] as number);
    const ry = (this.gWorld[1] as number) - (v.xipos[3 * b + 1] as number);
    const rz = (this.gWorld[2] as number) - (v.xipos[3 * b + 2] as number);
    v.xfrc[o] = (v.xfrc[o] as number) + fx; v.xfrc[o + 1] = (v.xfrc[o + 1] as number) + fy; v.xfrc[o + 2] = (v.xfrc[o + 2] as number) + fz;
    v.xfrc[o + 3] = (v.xfrc[o + 3] as number) + ry * fz - rz * fy;
    v.xfrc[o + 4] = (v.xfrc[o + 4] as number) + rz * fx - rx * fz;
    v.xfrc[o + 5] = (v.xfrc[o + 5] as number) + rx * fy - ry * fx;
    this.force = m > FORCE_CAP ? FORCE_CAP : m;
    if (this.force > this.peak) this.peak = this.force;
    return true;
  };

  private readonly keyStep = (v: HeroViews): boolean => {
    if (this.keySteps <= 0) return false;
    const o = 6 * this.d.primaryBody;
    v.xfrc[o] = (v.xfrc[o] as number) + KEY_PUSH_FORCE * this.keyDir[0];
    v.xfrc[o + 1] = (v.xfrc[o + 1] as number) + KEY_PUSH_FORCE * this.keyDir[1];
    v.xfrc[o + 2] = (v.xfrc[o + 2] as number) + KEY_PUSH_FORCE * this.keyDir[2];
    this.keySteps--;
    return true;
  };

  private holdDragging(on: boolean): void {
    if (on && !this.dragging) { this.dragging = true; this.d.scheduler.acquire('dragging'); }
    else if (!on && this.dragging && this.pointerId === undefined && this.keySteps <= 0) {
      this.dragging = false; this.d.scheduler.release('dragging');
    }
  }

  down(e: { pointerId: number; clientX: number; clientY: number; button?: number }): void {
    if (this.disabled || this.pointerId !== undefined) return; // second pointer ignored
    if (e.button !== undefined && e.button > 0) return;
    const hit = this.pickAt(e);
    if (!hit) return;
    this.pointerId = e.pointerId;
    this.body = hit.body;
    const g = this.d.bodyGroups[hit.body];
    const p = new this.d.THREE.Vector3(hit.point[0], hit.point[1], hit.point[2]);
    if (g) { g.updateWorldMatrix(true, false); g.worldToLocal(p); }
    this.gLocal[0] = p.x; this.gLocal[1] = p.y; this.gLocal[2] = p.z;
    this.target[0] = hit.point[0]; this.target[1] = hit.point[1]; this.target[2] = hit.point[2];
    this.gWorld.set(this.target);
    this.force = 0; this.peak = 0;
    try { (this.d.canvas as HTMLElement & { setPointerCapture?(id: number): void }).setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
    this.d.canvas.style.touchAction = 'none';
    this.d.hero.setForce('shove', this.shoveStep);
    this.holdDragging(true);
    this.setLabel(0);
  }

  move(e: { pointerId: number; clientX: number; clientY: number }): void {
    if (e.pointerId !== this.pointerId) return;
    const n = shovePlaneNormal(this.camDir());
    if (!n) return;
    const ray = this.rayOf(e);
    const G: V3 = [this.gWorld[0] as number, this.gWorld[1] as number, this.gWorld[2] as number];
    const P = rayPlane(ray.origin, ray.dir, G, n);
    if (!P) return; // keep the previous target
    this.target[0] = P[0]; this.target[1] = P[1]; this.target[2] = P[2];
    this.d.hero.wake();
  }

  up(e: { pointerId: number }): void {
    if (e.pointerId !== this.pointerId) return;
    const peak = Math.round(this.peak);
    this.endShove();
    this.d.announce(`Pushed with a peak of ${peak} N`);
  }

  private endShove(): void {
    if (this.pointerId === undefined) return;
    this.pointerId = undefined;
    this.d.hero.setForce('shove', null);
    this.d.canvas.style.touchAction = '';
    this.holdDragging(false);
    if (this.keySteps <= 0) this.clearVisual();
  }

  key(e: KeyboardEvent | { key: string; shiftKey: boolean; preventDefault(): void }): void {
    if (e.key === 'Escape') { this.cancel(); return; }
    if (!ARROW_KEYS.has(e.key)) return;
    e.preventDefault();
    if (e.shiftKey) { this.d.orbitKey?.(e as KeyboardEvent); return; }
    if (this.disabled) return;
    const dir = keyPushDirection(e.key as ArrowKey, this.camDir());
    if (!dir) return;
    this.keyDir = dir;
    this.keyName = e.key as ArrowKey;
    this.keySteps = keyPushSteps(this.d.simDt);
    this.d.hero.setForce('key', this.keyStep, () => this.keyEnded());
    this.holdDragging(true);
    this.setLabel(KEY_PUSH_FORCE);
  }

  private keyEnded(): void {
    const name = this.keyName;
    this.keySteps = 0;
    this.keyName = undefined;
    this.holdDragging(false);
    if (this.pointerId === undefined) this.clearVisual();
    if (name) this.d.announce(`Pushed 100 N toward the ${directionName(name)}`);
  }

  /** Escape: cancels any shove or key push without an announcement. */
  cancel(): void {
    this.endShove();
    if (this.keySteps > 0 || this.d.hero.hasForce('key')) {
      this.keySteps = 0;
      this.keyName = undefined;
      this.d.hero.setForce('key', null);
      this.holdDragging(false);
    }
    this.clearVisual();
  }

  get active(): boolean { return this.pointerId !== undefined || this.keySteps > 0; }

  /** Newtons the hero is being pushed with right now (pointer spring or key push), 0 when no push is active. */
  get liveForce(): number { return this.pointerId !== undefined ? this.force : this.keySteps > 0 ? KEY_PUSH_FORCE : 0; }

  /**
   * Draws the push a sentence describes, before any test runs: the shove arrow pointing at `body` along the force,
   * `length` metres long, labelled with the force. Ignored while a real push is active.
   */
  preview(body: number, fx: number, fy: number, fz: number, length: number): void {
    const m = Math.hypot(fx, fy, fz);
    if (!(m > 0) || !(body >= 0)) { this.clearPreview(); return; }
    this.previewBody = body;
    this.previewDir[0] = fx / m; this.previewDir[1] = fy / m; this.previewDir[2] = fz / m;
    this.previewForce = m;
    this.previewLength = length;
    this.d.scheduler.requestOnce();
  }

  clearPreview(): void {
    if (this.previewBody < 0) return;
    this.previewBody = -1;
    if (!this.active) this.clearVisual();
  }

  get previewing(): boolean { return this.previewBody >= 0; }

  private setLabel(n: number): void {
    const t = `${Math.round(n)} N`;
    if (t !== this.label) { this.label = t; this.labelEl.textContent = t; }
    this.labelEl.hidden = false;
  }

  private clearVisual(): void {
    this.label = '';
    this.labelEl.textContent = '';
    this.labelEl.hidden = true;
    this.arrow.visible = false;
    this.d.scheduler.requestOnce();
  }

  /** Per frame: place the arrow and the label. */
  update(): void {
    const T = this.d.THREE;
    let sx: number, sy: number, sz: number, ex: number, ey: number, ez: number;
    if (this.pointerId !== undefined) {
      this.worldGrab(this.d.hero.views);
      sx = this.gWorld[0] as number; sy = this.gWorld[1] as number; sz = this.gWorld[2] as number;
      ex = this.target[0] as number; ey = this.target[1] as number; ez = this.target[2] as number;
      this.setLabel(this.force);
    } else if (this.keySteps > 0) {
      const v = this.d.hero.views, b = this.d.primaryBody;
      ex = v.xipos[3 * b] as number; ey = v.xipos[3 * b + 1] as number; ez = v.xipos[3 * b + 2] as number;
      sx = ex - 0.3 * this.keyDir[0]; sy = ey - 0.3 * this.keyDir[1]; sz = ez - 0.3 * this.keyDir[2];
      this.setLabel(KEY_PUSH_FORCE);
    } else if (this.previewBody >= 0) {
      const v = this.d.hero.views, b = this.previewBody, L = this.previewLength, pd = this.previewDir;
      ex = v.xipos[3 * b] as number; ey = v.xipos[3 * b + 1] as number; ez = v.xipos[3 * b + 2] as number;
      sx = ex - L * (pd[0] as number); sy = ey - L * (pd[1] as number); sz = ez - L * (pd[2] as number);
      this.setLabel(this.previewForce);
    } else return;
    const len = Math.hypot(ex - sx, ey - sy, ez - sz);
    this.arrow.visible = len > 1e-4;
    if (!this.arrow.visible) return;
    this.arrow.position.set(sx, sy, sz);
    const dir = new T.Vector3(ex - sx, ey - sy, ez - sz).normalize();
    this.arrow.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
    this.shaft.scale.set(1, len, 1);
    this.head.position.set(0, len, 0);
    const mid = new T.Vector3((sx + ex) / 2, (sy + ey) / 2, (sz + ez) / 2).project(this.d.camera);
    const w = this.d.canvas.clientWidth, h = this.d.canvas.clientHeight;
    this.labelEl.style.transform = `translate(${Math.round((mid.x * 0.5 + 0.5) * w)}px, ${Math.round((-mid.y * 0.5 + 0.5) * h)}px)`;
  }

  dispose(): void {
    this.cancel();
    for (const [t, fn, o] of this.listeners) this.d.canvas.removeEventListener(t, fn, o);
    this.arrow.removeFromParent();
    this.shaft.geometry.dispose();
    this.head.geometry.dispose();
    this.arrowMat.dispose();
    this.labelEl.remove();
  }
}
