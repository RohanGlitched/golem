// The Stage: renderer, camera, floor, theme, resize, Visibility_Gate and WebGL loss. No React.
import type * as THREE_NS from 'three';
import type { RenderScheduler } from '../core/scheduler.js';
import type { TokenSet } from '../types.js';
import { createFloor, setFloorTheme } from './floor.js';
import type { Floor } from './floor.js';
import { createOrbit } from './orbit.js';
import type { Orbit } from './orbit.js';
import type { StageParts } from './stage-builder.js';

type Three = typeof THREE_NS;

export const PIXEL_RATIO_CAP = 1.5;
export const pixelRatioFor = (dpr: number): number => Math.min(dpr > 0 ? dpr : 1, PIXEL_RATIO_CAP);

export const PUSH_INSTRUCTIONS = 'Arrow keys push the robot with 100 N for 0.2 s. Shift with arrow keys turns the camera';
export const STAGE_LABEL = 'Robot stage: the clay robot, its ghost trials and the floor aura. Drag a body to shove it.';
export const LOADING_TEXT = 'Loading the robot';
export const LOST_TEXT = 'The 3D view was lost';
export const NO_WEBGL_TEXT = 'WebGL is required for the 3D view: use a browser with WebGL 2 enabled';
export const SLOW_TEXT = 'Running slower than real time';

/** The parts of WebGLRenderer the studio uses; tests pass a fake. */
export interface Renderer {
  domElement?: HTMLCanvasElement;
  setPixelRatio(r: number): void;
  getPixelRatio?(): number;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  render(scene: THREE_NS.Object3D, camera: THREE_NS.Camera): void;
  setRenderTarget?(t: THREE_NS.WebGLRenderTarget | null): void;
  readRenderTargetPixels?(t: THREE_NS.WebGLRenderTarget, x: number, y: number, w: number, h: number, buf: Uint8Array): void;
  info?: { render: { calls: number } };
  dispose(): void;
}

export interface StageDeps {
  THREE: Three;
  scheduler: RenderScheduler;
  tokens: TokenSet;
  createRenderer?: (canvas: HTMLCanvasElement) => Renderer;
  devicePixelRatio?: () => number;
  reduced(): boolean;
  isOnBody?(e: PointerEvent): boolean;
  /** The Visibility_Gate changed: pause or resume the hero. */
  onVisibility?(visible: boolean): void;
  onContextRestored?(): void;
}

let uid = 0;

export class Stage {
  readonly el: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly scene: THREE_NS.Scene;
  readonly camera: THREE_NS.PerspectiveCamera;
  readonly renderer: Renderer;
  readonly orbit: Orbit;
  readonly floor: Floor;
  private readonly msg: HTMLDivElement;
  private readonly slow: HTMLDivElement;
  private readonly themeables: ((t: TokenSet) => void)[] = [];
  private readonly disposers: (() => void)[] = [];
  private onScreen = true;
  private docVisible = true;
  private visible = true;
  parts: StageParts | undefined;
  baseXY: [number, number] = [0, 0];
  radius = 1;
  lost = false;

  constructor(host: HTMLElement, private readonly deps: StageDeps) {
    const T = deps.THREE;
    const doc = host.ownerDocument;
    const id = `golem-stage-${++uid}`;
    this.el = doc.createElement('div');
    this.el.className = 'golem-stage';
    this.canvas = doc.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', STAGE_LABEL);
    this.canvas.setAttribute('aria-describedby', `${id}-help`);
    this.canvas.className = 'golem-canvas';
    const help = doc.createElement('p');
    help.id = `${id}-help`;
    help.className = 'golem-sr-only';
    help.textContent = PUSH_INSTRUCTIONS;
    this.msg = doc.createElement('div');
    this.msg.className = 'golem-stage-msg';
    this.msg.textContent = LOADING_TEXT;
    this.slow = doc.createElement('div');
    this.slow.className = 'golem-stage-slow';
    this.slow.hidden = true;
    this.slow.textContent = SLOW_TEXT;
    this.el.append(this.canvas, help, this.msg, this.slow);
    host.appendChild(this.el);

    this.renderer = deps.createRenderer
      ? deps.createRenderer(this.canvas)
      : (new T.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' }) as unknown as Renderer);
    const dpr = deps.devicePixelRatio ? deps.devicePixelRatio() : (doc.defaultView?.devicePixelRatio ?? 1);
    this.renderer.setPixelRatio(pixelRatioFor(dpr));

    this.scene = new T.Scene();
    this.scene.background = new T.Color(deps.tokens.ground);
    this.camera = new T.PerspectiveCamera(40, 1, 0.02, 80);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(2.2, -2.2, 1.2);
    this.floor = createFloor(T, undefined, deps.tokens);
    this.scene.add(this.floor.mesh);
    this.scene.fog = this.floor.fog;

    this.orbit = createOrbit(T, this.camera, this.canvas, {
      scheduler: deps.scheduler, reduced: deps.reduced, isOnBody: (e) => deps.isOnBody?.(e) ?? false,
    });
    this.onTheme((t) => {
      (this.scene.background as THREE_NS.Color).set(t.ground);
      setFloorTheme(this.floor, t);
    });

    // Visibility_Gate.
    const win = doc.defaultView;
    const IO = (win as unknown as { IntersectionObserver?: typeof IntersectionObserver } | null)?.IntersectionObserver;
    if (IO) {
      const io = new IO((entries) => {
        const e = entries[entries.length - 1];
        if (e) { this.onScreen = e.isIntersecting; this.updateVisible(); }
      }, { threshold: 0 });
      io.observe(this.el);
      this.disposers.push(() => io.disconnect());
    }
    const onVis = (): void => { this.docVisible = doc.visibilityState !== 'hidden'; this.updateVisible(); };
    doc.addEventListener('visibilitychange', onVis);
    this.disposers.push(() => doc.removeEventListener('visibilitychange', onVis));
    const RO = (win as unknown as { ResizeObserver?: typeof ResizeObserver } | null)?.ResizeObserver;
    if (RO) {
      const ro = new RO(() => this.resize());
      ro.observe(this.el);
      this.disposers.push(() => ro.disconnect());
    }
    const onLost = (e: Event): void => { e.preventDefault(); this.lost = true; this.showMessage(LOST_TEXT); };
    const onRestored = (): void => { this.lost = false; this.showMessage(undefined); deps.onContextRestored?.(); deps.scheduler.requestOnce(); };
    this.canvas.addEventListener('webglcontextlost', onLost);
    this.canvas.addEventListener('webglcontextrestored', onRestored);
    this.disposers.push(() => {
      this.canvas.removeEventListener('webglcontextlost', onLost);
      this.canvas.removeEventListener('webglcontextrestored', onRestored);
    });
    this.resize();
  }

  /** Registers a theme listener (clay, ghosts, aura). */
  onTheme(fn: (t: TokenSet) => void): void { this.themeables.push(fn); }

  setModel(parts: StageParts, bound: { radius: number; centre: THREE_NS.Vector3; height: number }): void {
    const T = this.deps.THREE;
    this.parts = parts;
    this.scene.add(parts.root);
    if (parts.floor) this.floor.mesh.position.set(parts.floor.pos[0], parts.floor.pos[1], parts.floor.pos[2]);
    this.radius = bound.radius;
    this.baseXY = [bound.centre.x, bound.centre.y];
    const target = new T.Vector3(bound.centre.x, bound.centre.y, 0.55 * bound.height);
    const d = 2.6 * bound.radius;
    const az = (-60 * Math.PI) / 180, el = (18 * Math.PI) / 180;
    this.camera.position.set(target.x + d * Math.cos(el) * Math.cos(az), target.y + d * Math.cos(el) * Math.sin(az), target.z + d * Math.sin(el));
    this.camera.near = Math.max(0.01, bound.radius / 50);
    this.camera.far = 80;
    this.camera.updateProjectionMatrix();
    this.orbit.setLimits(bound.radius, target);
    this.deps.scheduler.requestOnce();
  }

  setTheme(t: TokenSet): void {
    for (const fn of this.themeables) fn(t);
    this.deps.scheduler.requestOnce();
  }

  resize(): void {
    const w = Math.max(1, this.el.clientWidth || 1), h = Math.max(1, this.el.clientHeight || 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.deps.scheduler.requestOnce();
  }

  isVisible(): boolean { return this.visible; }

  private updateVisible(): void {
    const v = this.onScreen && this.docVisible;
    if (v === this.visible) return;
    this.visible = v;
    this.deps.scheduler.setVisible(v);
    this.deps.onVisibility?.(v);
  }

  /** Test seam and the gate's entry point for host-driven visibility. */
  setGate(onScreen: boolean, docVisible = this.docVisible): void { this.onScreen = onScreen; this.docVisible = docVisible; this.updateVisible(); }

  showMessage(text: string | undefined): void {
    this.msg.textContent = text ?? '';
    this.msg.hidden = !text;
  }
  get message(): string { return this.msg.hidden ? '' : this.msg.textContent ?? ''; }

  setSlow(slow: boolean): void { if (this.slow.hidden === slow) this.slow.hidden = !slow; }

  render(): void { if (!this.lost) this.renderer.render(this.scene, this.camera); }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
    this.orbit.dispose();
    this.floor.mesh.geometry.dispose();
    this.floor.material.dispose();
    if (this.parts) {
      const geos = new Set<THREE_NS.BufferGeometry>();
      const mats = new Set<THREE_NS.Material>();
      for (const m of this.parts.meshes) { geos.add(m.geometry); mats.add(m.material as THREE_NS.Material); }
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    }
    this.renderer.dispose();
    this.el.remove();
  }
}
