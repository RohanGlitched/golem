// The Stage: renderer, camera, floor, theme, resize, Visibility_Gate and WebGL loss. No React.
import type * as THREE_NS from 'three';
import type { RenderScheduler } from '../core/scheduler.js';
import type { TokenSet } from '../types.js';
import { createFloor, setFloorTheme } from './floor.js';
import type { Floor } from './floor.js';
import { createOrbit } from './orbit.js';
import type { Orbit } from './orbit.js';
import type { StageParts } from './stage-builder.js';
import { KEY_AZIMUTH_DEG, KEY_ELEVATION_DEG, lightDir } from './clay-material.js';

/** Lamp pool on the floor: a soft disc of light that follows the camera target. */
export const POOL_RADIUS = 2.6;
export const POOL_GAIN = 0.2;
export const SHADOW_OPACITY = 0.5;
/** On the light studio backdrop a softer shadow reads as the same contact. */
export const SHADOW_OPACITY_LIGHT = 0.3;
/** The shadow light is steeper than the clay's raking key, so the cast shadow stays near the feet. */
export const SHADOW_ELEVATION_DEG = 56;
const isLightGround = (hex: string): boolean => { const n = parseInt(hex.replace('#', ''), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128; };
export const SHADOW_HALF = 1.8;
/** Camera follow time constant (s): critically damped toward the followed point. */
export const FOLLOW_TAU = 0.5;

const POOL_VERT = /* glsl */ `
varying vec2 vXY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vXY = wp.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const POOL_FRAG = /* glsl */ `
uniform vec3 uLight;
uniform vec2 uCentre;
uniform float uRadius;
uniform float uGain;
varying vec2 vXY;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 d = (vXY - uCentre) / vec2(uRadius, uRadius * 0.82);
  float r = length(d);
  float pool = 1.0 - smoothstep(0.0, 1.0, r);
  pool = pool * pool * (3.0 - 2.0 * pool);
  float grain = (h(floor(vXY * 900.0)) - 0.5) * 0.06;
  float a = uGain * pool * (1.0 + grain);
  if (a <= 0.001) discard;
  gl_FragColor = vec4(uLight, a);
  #include <colorspace_fragment>
}
`;


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

  private bound: { radius: number; target: THREE_NS.Vector3 } | undefined;
  private readonly pool: THREE_NS.Mesh;
  private readonly poolMat: THREE_NS.ShaderMaterial;
  private readonly catcher: THREE_NS.Mesh;
  private readonly shadowMat: THREE_NS.ShadowMaterial;
  private readonly key: THREE_NS.DirectionalLight;
  private readonly keyDir: THREE_NS.Vector3;
  private followGoal: [number, number] | undefined;
  private lastFollowTs = 0;

  private placeLight(x: number, y: number): void {
    this.key.target.position.set(x, y, 0.4);
    this.key.position.set(x + 6 * this.keyDir.x, y + 6 * this.keyDir.y, 0.4 + 6 * this.keyDir.z);
    this.key.target.updateMatrixWorld();
    (this.poolMat.uniforms['uCentre']!.value as THREE_NS.Vector2).set(x, y);
    this.pool.position.x = x; this.pool.position.y = y;
    this.catcher.position.x = x; this.catcher.position.y = y;
  }

  /** Follow a floor point (the robot's root, the ghost swarm's centre or a replay) with critical damping. */
  follow(x: number, y: number): void { this.followGoal = [x, y]; }

  /** Moves target, camera, light and pool one damped step toward the follow goal. Returns true while moving. */
  stepFollow(nowMs: number, reduced: boolean): boolean {
    const goal = this.followGoal;
    if (!goal || !this.bound) return false;
    const t = this.orbit.controls.target;
    const dt = this.lastFollowTs > 0 ? Math.min(0.1, Math.max(0, (nowMs - this.lastFollowTs) / 1000)) : 1 / 60;
    this.lastFollowTs = nowMs;
    const dx = goal[0] - t.x, dy = goal[1] - t.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) { this.lastFollowTs = 0; return false; }
    const a = reduced ? 1 : 1 - Math.exp(-dt / FOLLOW_TAU);
    const mx = dx * a, my = dy * a;
    t.x += mx; t.y += my;
    this.camera.position.x += mx; this.camera.position.y += my;
    this.placeLight(t.x, t.y);
    return dist > 2e-3;
  }

  /** 2.6 R on a wide stage; farther on a narrow one so the robot fits the horizontal field of view. */
  private fitDistance(): number {
    const R = this.bound?.radius ?? 1;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    return Math.max(2.6 * R, (1.15 * R) / Math.sin(Math.min(vfov, hfov) / 2));
  }

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

    // Lamp pool, shadow catcher and the shadow-casting key light. The clay shader does its own
    // lighting; the light exists only to cast the robot's shadow onto the floor.
    const sm = (this.renderer as unknown as { shadowMap?: { enabled: boolean; type: number } }).shadowMap;
    if (sm) { sm.enabled = true; sm.type = T.PCFSoftShadowMap; }
    this.poolMat = new T.ShaderMaterial({
      vertexShader: POOL_VERT, fragmentShader: POOL_FRAG,
      uniforms: {
        uLight: { value: new T.Color(deps.tokens.clay) }, uCentre: { value: new T.Vector2(0, 0) },
        uRadius: { value: POOL_RADIUS }, uGain: { value: POOL_GAIN },
      },
      transparent: true, depthWrite: false,
    });
    this.pool = new T.Mesh(new T.PlaneGeometry(4 * POOL_RADIUS, 4 * POOL_RADIUS), this.poolMat);
    this.pool.position.z = 0.0005; this.pool.renderOrder = 0; this.pool.name = 'golem-lamp-pool';
    this.scene.add(this.pool);
    this.shadowMat = new T.ShadowMaterial({ opacity: isLightGround(deps.tokens.ground) ? SHADOW_OPACITY_LIGHT : SHADOW_OPACITY, color: new T.Color('#000000'), depthWrite: false, transparent: true });
    this.catcher = new T.Mesh(new T.PlaneGeometry(4 * SHADOW_HALF, 4 * SHADOW_HALF), this.shadowMat);
    this.catcher.position.z = 0.001; this.catcher.receiveShadow = true; this.catcher.renderOrder = 0; this.catcher.name = 'golem-shadow';
    this.scene.add(this.catcher);
    this.key = new T.DirectionalLight(0xffffff, 1);
    const kd = lightDir(KEY_AZIMUTH_DEG, Math.max(KEY_ELEVATION_DEG, SHADOW_ELEVATION_DEG));
    this.keyDir = new T.Vector3(kd[0], kd[1], kd[2]).normalize();
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera as THREE_NS.OrthographicCamera;
    sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF; sc.near = 0.1; sc.far = 12;
    this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.02; this.key.shadow.radius = 4;
    this.scene.add(this.key, this.key.target);
    this.placeLight(0, 0);

    this.orbit = createOrbit(T, this.camera, this.canvas, {
      scheduler: deps.scheduler, reduced: deps.reduced, isOnBody: (e) => deps.isOnBody?.(e) ?? false,
    });
    this.onTheme((t) => {
      (this.scene.background as THREE_NS.Color).set(t.ground);
      setFloorTheme(this.floor, t);
      (this.poolMat.uniforms['uLight']!.value as THREE_NS.Color).set(t.clay);
      this.shadowMat.opacity = isLightGround(t.ground) ? SHADOW_OPACITY_LIGHT : SHADOW_OPACITY;
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
    for (const m of parts.meshes) { m.castShadow = true; m.receiveShadow = false; }
    if (parts.floor) this.floor.mesh.position.set(parts.floor.pos[0], parts.floor.pos[1], parts.floor.pos[2]);
    this.radius = bound.radius;
    this.baseXY = [bound.centre.x, bound.centre.y];
    const target = new T.Vector3(bound.centre.x, bound.centre.y, 0.55 * bound.height);
    this.bound = { radius: bound.radius, target };
    const d = this.fitDistance();
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
    if (this.bound) {
      const off = this.camera.position.clone().sub(this.orbit.controls.target);
      const want = this.fitDistance();
      if (off.length() < want - 1e-6) { this.camera.position.copy(this.orbit.controls.target).addScaledVector(off.normalize(), want); this.orbit.controls.update(); }
    }
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
    this.pool.geometry.dispose(); this.poolMat.dispose();
    this.catcher.geometry.dispose(); this.shadowMat.dispose();
    this.key.shadow.map?.dispose();
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
