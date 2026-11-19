// Emet_Decal: the word "emet" incised on the head, as one plane with a canvas texture. The first "e"
// crumbles with a value-noise dissolve and 28 falling grains, all computed in shaders from one uniform, so an
// animating frame writes one number and allocates nothing.
import type * as THREE_NS from 'three';
import { CRUMBLE_S, EMET_HINT, stepCrumble } from '../core/emet.js';
import type { EmetWord, ForeheadSpot } from '../core/emet.js';
import { deriveStream } from '../core/prng.js';
import type { TokenSet } from '../types.js';
import type { StageParts } from '../stage/stage-builder.js';

type Three = typeof THREE_NS;

export const HINT_KEY = 'golem:emet-hint';
export const GRAINS = 28;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uCrumble;
uniform float uSplit;
uniform vec3 uInk;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec4 t = texture2D(uMap, vUv);
  float n = h(floor(vUv * vec2(160.0, 40.0)));
  // Only the first letter (u < uSplit) crumbles.
  float edge = vUv.x < uSplit ? uCrumble * 1.2 - 0.1 : -1.0;
  if (n < edge) discard;
  float rim = smoothstep(edge, edge + 0.12, n);
  float a = t.a * (0.25 + 0.75 * rim);
  if (a < 0.02) discard;
  // Incised: the strokes are darker clay; the alpha channel carries a lit lower lip.
  gl_FragColor = vec4(mix(uInk * 1.9, uInk, t.r), a);
  #include <colorspace_fragment>
}
`;
const GRAIN_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uCrumble;
uniform float uScale;
varying float vA;
void main() {
  float t = clamp((uCrumble - aSeed.z * 0.45) / 0.55, 0.0, 1.0);
  vec3 p = position + vec3((aSeed.x - 0.5) * 0.6 * t, -1.6 * t * t, 0.35 * t) * uScale;
  vA = t > 0.0 && t < 1.0 ? 1.0 - t : 0.0;
  gl_PointSize = 2.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const GRAIN_FRAG = /* glsl */ `
uniform vec3 uInk;
varying float vA;
void main() { if (vA <= 0.0) discard; gl_FragColor = vec4(uInk, vA * 0.9); }
`;

export interface EmetDeps {
  THREE: Three;
  tokens: TokenSet;
  spot: ForeheadSpot;
  /** The stage element the one-time hint is shown in. */
  hintHost?: HTMLElement;
  storage?: Storage | undefined;
  announce?(text: string): void;
  reduced(): boolean;
}

export class EmetDecal {
  readonly group: THREE_NS.Group;
  word: EmetWord = 'emet';
  crumble = 0;
  private readonly texture: THREE_NS.Texture | undefined;
  private readonly mat: THREE_NS.ShaderMaterial;
  private readonly grains: THREE_NS.Points;
  /** Centres (plane x, m) of the first "e" and of "met". */
  readonly eCentreX: number;
  readonly metCentreX: number;
  private readonly grainMat: THREE_NS.ShaderMaterial;
  private readonly geos: THREE_NS.BufferGeometry[] = [];
  private lastMs = 0;
  private hint: HTMLElement | undefined;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly d: EmetDeps) {
    const T = d.THREE;
    this.group = new T.Group();
    this.group.name = 'golem-emet';
    const { canvas, split, u0, u1 } = drawWord(d.hintHost?.ownerDocument);
    this.texture = canvas ? new T.CanvasTexture(canvas) : undefined;
    if (this.texture) { this.texture.colorSpace = T.SRGBColorSpace; this.texture.anisotropy = 4; }
    const ink = new T.Color(d.tokens.clay).multiplyScalar(0.42);
    this.mat = new T.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { uMap: { value: this.texture ?? null }, uCrumble: { value: 0 }, uSplit: { value: split }, uInk: { value: ink.clone() } },
    });
    // The word spans u0..u1 of the 512 × 128 canvas; W is its width on the head.
    const W = d.spot.width, H = (W * 128) / ((u1 - u0) * 512);
    const wE = (W * (split - u0)) / (u1 - u0), wM = W - wE;
    // One plane (one draw call): the shader crumbles only u < split, the first "e".
    const g = new T.PlaneGeometry(W, H);
    const uv = g.getAttribute('uv') as THREE_NS.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + (u1 - u0) * (uv.getX(i) as number));
    this.geos.push(g);
    const word = new T.Mesh(g, this.mat);
    word.name = 'golem-emet-word';
    this.eCentreX = -W / 2 + wE / 2;
    this.metCentreX = -W / 2 + wE + wM / 2;
    // Grains: seeded positions inside the "e".
    const rng = deriveStream(7, 'emet-grains');
    const pos = new Float32Array(3 * GRAINS), seed = new Float32Array(3 * GRAINS);
    for (let i = 0; i < GRAINS; i++) {
      pos[3 * i] = -W / 2 + wE * (0.15 + 0.7 * rng()); pos[3 * i + 1] = H * (0.35 * rng() - 0.2); pos[3 * i + 2] = 0.0005;
      seed[3 * i] = rng(); seed[3 * i + 1] = rng(); seed[3 * i + 2] = rng();
    }
    const gg = new T.BufferGeometry();
    gg.setAttribute('position', new T.BufferAttribute(pos, 3));
    gg.setAttribute('aSeed', new T.BufferAttribute(seed, 3));
    this.geos.push(gg);
    this.grainMat = new T.ShaderMaterial({
      vertexShader: GRAIN_VERT, fragmentShader: GRAIN_FRAG, transparent: true, depthWrite: false,
      uniforms: { uCrumble: { value: 0 }, uScale: { value: H }, uInk: { value: ink.clone() } },
    });
    const grains = new T.Points(gg, this.grainMat);
    grains.frustumCulled = false;
    grains.visible = false;
    word.renderOrder = 5;
    grains.renderOrder = 6;
    this.grains = grains;
    this.group.add(word, grains);
    // Orient: plane x → right (up × normal), plane y → up (body z), plane z → the normal.
    const nrm = new T.Vector3(...d.spot.normal).normalize();
    const up = new T.Vector3(0, 0, 1);
    if (Math.abs(nrm.dot(up)) > 0.95) up.set(0, 1, 0);
    const right = new T.Vector3().crossVectors(up, nrm).normalize();
    const trueUp = new T.Vector3().crossVectors(nrm, right).normalize();
    this.group.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(right, trueUp, nrm));
    this.group.position.set(d.spot.at[0] + 0.0015 * nrm.x, d.spot.at[1] + 0.0015 * nrm.y, d.spot.at[2] + 0.0015 * nrm.z);
  }

  /** The word to show. Returns true when it changed (the caller then animates with `update`). */
  setWord(word: EmetWord, nowMs: number): boolean {
    if (word === this.word) return false;
    this.word = word;
    this.lastMs = nowMs;
    if (word === 'met') this.maybeHint();
    return true;
  }

  /** Advances the crumble. Returns true while it still moves. No allocation. */
  update(nowMs: number): boolean {
    const dt = this.lastMs > 0 ? (nowMs - this.lastMs) / 1000 : 1 / 60;
    this.lastMs = nowMs;
    const c = stepCrumble(this.crumble, this.word, Math.min(dt, CRUMBLE_S), this.d.reduced());
    if (c === this.crumble) return false;
    this.crumble = c;
    this.mat.uniforms['uCrumble']!.value = c;
    this.grainMat.uniforms['uCrumble']!.value = this.d.reduced() ? 0 : c;
    // The grains draw only while they fall.
    this.grains.visible = !this.d.reduced() && c > 0 && c < 1;
    return c !== (this.word === 'met' ? 1 : 0);
  }

  get animating(): boolean { return this.crumble !== (this.word === 'met' ? 1 : 0); }

  setTheme(t: TokenSet): void {
    const ink = new this.d.THREE.Color(t.clay).multiplyScalar(0.42);
    for (const m of [this.mat, this.grainMat]) (m.uniforms['uInk']!.value as THREE_NS.Color).copy(ink);
  }

  private maybeHint(): void {
    const s = this.d.storage;
    try { if (s?.getItem(HINT_KEY)) return; s?.setItem(HINT_KEY, '1'); } catch { /* private mode */ }
    this.d.announce?.(EMET_HINT);
    const host = this.d.hintHost;
    if (!host) return;
    const p = host.ownerDocument.createElement('p');
    p.className = 'golem-stage-hint';
    p.textContent = EMET_HINT;
    host.appendChild(p);
    this.hint = p;
    this.hintTimer = setTimeout(() => { this.hint?.remove(); this.hint = undefined; }, 7000);
  }

  dispose(): void {
    if (this.hintTimer !== undefined) clearTimeout(this.hintTimer);
    this.hint?.remove();
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    this.mat.dispose(); this.grainMat.dispose();
    this.texture?.dispose();
  }
}

/** Up to `max` vertices (x, y, z) of a body's drawn meshes in the body frame. Called once per model. */
export function bodyPoints(T: Three, parts: StageParts, body: number, max = 60000): Float32Array {
  const infos = parts.geomInfo.filter((g) => g.body === body);
  let total = 0;
  for (const gi of infos) total += (gi.mesh.geometry.getAttribute('position') as THREE_NS.BufferAttribute | undefined)?.count ?? 0;
  const stride = Math.max(1, Math.ceil(total / max));
  const out: number[] = [];
  const v = new T.Vector3();
  for (const gi of infos) {
    const pos = gi.mesh.geometry.getAttribute('position') as THREE_NS.BufferAttribute | undefined;
    if (!pos) continue;
    gi.mesh.updateMatrix();
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(gi.mesh.matrix);
      out.push(v.x, v.y, v.z);
    }
  }
  return Float32Array.from(out);
}

/** The body whose drawn geometry reaches highest in the current pose (the head of a humanoid), or -1. */
export function highestBody(T: Three, parts: StageParts): number {
  parts.root.updateMatrixWorld(true);
  const box = new T.Box3();
  let best = -1, top = -Infinity;
  for (const m of parts.meshes) {
    box.setFromObject(m);
    if (!box.isEmpty() && box.max.z > top) { top = box.max.z; best = m.userData['bodyId'] as number; }
  }
  return best;
}

/**
 * Draws "emet" on a 512 × 128 canvas: red channel 1 in the strokes and 0 on the lit lower lip, alpha the union.
 * Returns the split (the first "e"'s share of the width). No canvas (tests): no texture, split 0.25.
 */
export function drawWord(doc: Document | undefined): { canvas: HTMLCanvasElement | undefined; split: number; u0: number; u1: number } {
  const none = { canvas: undefined, split: 0.25, u0: 0, u1: 1 };
  if (!doc) return none;
  const c = doc.createElement('canvas');
  c.width = 512; c.height = 128;
  let g: CanvasRenderingContext2D | null = null;
  try { g = c.getContext('2d'); } catch { g = null; }
  if (!g) return none;
  g.font = "104px 'Gloock', Georgia, 'Times New Roman', serif";
  g.textBaseline = 'middle';
  const wE = g.measureText('e').width, wAll = g.measureText('emet').width;
  const x0 = (512 - wAll) / 2;
  // Lower lip first (lit edge of the cut), then the stroke.
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillText('emet', x0 + 3, 66 + 3);
  g.fillStyle = 'rgba(255,0,0,0.92)';
  g.fillText('emet', x0, 66);
  const u0 = Math.max(0, (x0 - 4) / 512), u1 = Math.min(1, (x0 + wAll + 8) / 512);
  const split = (x0 + wE + 2) / 512;
  return split > u0 && split < u1 ? { canvas: c, split, u0, u1 } : { canvas: c, split: u0 + 0.25 * (u1 - u0), u0, u1 };
}
