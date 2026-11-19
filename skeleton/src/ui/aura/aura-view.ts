// Aura on the floor: a decal of the measured boundary (36x1 texture, linear, wrapping) and
// instanced radial ticks at every broken trial. No glow, no shadow.
import type * as THREE_NS from 'three';
import type { TokenSet } from '../types.js';
import { AURA_BINS, AURA_RMAX, TICK_CAPACITY, encodeTexels } from './aura-model.js';
import type { AuraModel } from './aura-model.js';

type Three = typeof THREE_NS;

export const AURA_OPACITY = 0.34;
export const TICK_LEN = 0.07;
export const TICK_WID = 0.012;

export const AURA_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const AURA_FRAG = /* glsl */ `
uniform sampler2D uAura;
uniform vec3 uHold;
uniform vec3 uBreak;
uniform vec3 uInk;
uniform float uRmax;
uniform float uOpacity;
uniform vec2 uRefs;
varying vec2 vLocal;
const float TAU = 6.28318530718;
// Circularly smoothed boundary: a 7-tap Gaussian over neighbouring bins (sigma about 1.5 bins = 15 deg).
float boundary(float u) {
  float w[7]; w[0] = 0.0702; w[1] = 0.1311; w[2] = 0.1907; w[3] = 0.2160; w[4] = 0.1907; w[5] = 0.1311; w[6] = 0.0702;
  float s = 0.0, ws = 0.0;
  for (int k = 0; k < 7; k++) {
    float r = texture2D(uAura, vec2(u + float(k - 3) / 36.0, 0.5)).r;
    if (r > 0.004) { s += w[k] * r; ws += w[k]; }
  }
  return ws > 0.0 ? s / ws : 0.0;
}
void main() {
  float r = length(vLocal);
  float ang = atan(vLocal.y, vLocal.x);
  float u = fract(ang / TAU);
  float own = texture2D(uAura, vec2(u, 0.5)).r;
  float broke = texture2D(uAura, vec2(u, 0.5)).g;
  float R = boundary(u) * uRmax;
  float px = max(fwidth(r), 1e-4);
  // reference rings (100 N, 200 N) as faint etched circles
  float ref1 = uRefs.x > 0.0 ? 1.0 - smoothstep(0.0, 1.2 * px, abs(r - uRefs.x * uRmax)) : 0.0;
  float ref2 = uRefs.y > 0.0 ? 1.0 - smoothstep(0.0, 1.2 * px, abs(r - uRefs.y * uRmax)) : 0.0;
  float dashRef = step(0.5, fract(ang * 72.0 / TAU));
  float refs = max(ref1, ref2) * dashRef * 0.22;
  // the measured boundary: a crisp 2 px line, dashed where this direction has no data yet
  float line = R > 0.004 ? 1.0 - smoothstep(0.6 * px, 1.6 * px, abs(r - R)) : 0.0;
  line *= own > 0.004 ? 1.0 : step(0.5, fract(ang * 48.0 / TAU));
  // the held region: a faint fill that brightens toward the boundary
  float inside = R > 0.004 ? (1.0 - smoothstep(R - px, R, r)) * smoothstep(0.0, R, r) : 0.0;
  vec3 col = uHold;
  float a = uOpacity * 0.55 * inside + 0.9 * line;
  vec3 c = col * (a > 0.0 ? 1.0 : 0.0);
  float aa = max(a, refs);
  if (aa <= 0.002) discard;
  vec3 outc = a >= refs ? c : uInk;
  gl_FragColor = vec4(outc, aa);
  #include <colorspace_fragment>
}
`;

export const TICK_VERT = /* glsl */ `
attribute vec2 aQuad;
attribute vec2 aTick;
uniform float uLen;
uniform float uWid;
void main() {
  vec2 radial = vec2(cos(aTick.x), sin(aTick.x));
  vec2 across = vec2(-radial.y, radial.x);
  vec2 p = radial * (aTick.y + aQuad.x * uLen) + across * (aQuad.y * uWid);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 0.0, 1.0);
}
`;

export const TICK_FRAG = /* glsl */ `
uniform vec3 uBreak;
void main() {
  gl_FragColor = vec4(uBreak, 1.0);
  #include <colorspace_fragment>
}
`;

export class AuraView {
  readonly group: THREE_NS.Group;
  readonly texture: THREE_NS.DataTexture;
  readonly texels = new Uint8Array(AURA_BINS * 4);
  readonly decal: THREE_NS.Mesh;
  readonly ticks: THREE_NS.Mesh;
  private readonly decalMat: THREE_NS.ShaderMaterial;
  private readonly tickMat: THREE_NS.ShaderMaterial;
  private readonly tickGeo: THREE_NS.InstancedBufferGeometry;
  private readonly tickAttr: THREE_NS.InstancedBufferAttribute;

  constructor(
    private readonly T: Three, tokens: TokenSet,
    private readonly scheduler: { requestOnce(): void },
  ) {
    this.group = new T.Group();
    this.group.name = 'golem-aura';
    this.texture = new T.DataTexture(this.texels, AURA_BINS, 1, T.RGBAFormat, T.UnsignedByteType);
    this.texture.magFilter = T.LinearFilter;
    this.texture.minFilter = T.LinearFilter;
    this.texture.wrapS = T.RepeatWrapping;
    this.texture.wrapT = T.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.decalMat = new T.ShaderMaterial({
      vertexShader: AURA_VERT, fragmentShader: AURA_FRAG,
      uniforms: {
        uAura: { value: this.texture },
        uHold: { value: new T.Color(tokens.hold) },
        uBreak: { value: new T.Color(tokens.break) },
        uRmax: { value: AURA_RMAX },
        uOpacity: { value: AURA_OPACITY },
        uInk: { value: new T.Color(tokens.ink) },
        uRefs: { value: new T.Vector2(0, 0) },
      },
      transparent: true, depthWrite: false, blending: T.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.decal = new T.Mesh(new T.PlaneGeometry(2 * (AURA_RMAX + 0.06), 2 * (AURA_RMAX + 0.06)), this.decalMat);
    this.decal.position.z = 0.002;
    this.decal.renderOrder = 1;
    this.tickGeo = new T.InstancedBufferGeometry();
    this.tickGeo.setAttribute('aQuad', new T.BufferAttribute(new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), 2));
    this.tickGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(12), 3));
    this.tickGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const tick = new Float32Array(TICK_CAPACITY * 2);
    for (let i = 0; i < TICK_CAPACITY; i++) tick[2 * i + 1] = -10;
    this.tickAttr = new T.InstancedBufferAttribute(tick, 2);
    this.tickAttr.setUsage(T.DynamicDrawUsage);
    this.tickGeo.setAttribute('aTick', this.tickAttr);
    this.tickGeo.instanceCount = 0;
    this.tickMat = new T.ShaderMaterial({
      vertexShader: TICK_VERT, fragmentShader: TICK_FRAG,
      uniforms: { uLen: { value: TICK_LEN }, uWid: { value: TICK_WID }, uBreak: { value: new T.Color(tokens.break) } },
      depthWrite: false, transparent: false,
    });
    this.ticks = new T.Mesh(this.tickGeo, this.tickMat);
    this.ticks.position.z = 0.004;
    this.ticks.renderOrder = 2;
    this.ticks.frustumCulled = false;
    this.group.add(this.decal, this.ticks);
  }

  /** Rewrites the texture and the ticks from the model; one render request per trial batch. */
  write(m: AuraModel | undefined): void {
    if (!m) {
      this.texels.fill(0);
      this.tickGeo.instanceCount = 0;
    } else {
      encodeTexels(m, this.texels);
      const refs = this.decalMat.uniforms['uRefs']!.value as THREE_NS.Vector2;
      refs.set(m.forceMax > 100 ? 100 / m.forceMax : 0, m.forceMax > 200 ? 200 / m.forceMax : 0);
      const arr = this.tickAttr.array as Float32Array;
      const n = m.ticks.length;
      for (let i = 0; i < n; i++) {
        const t = m.ticks[i]!;
        arr[2 * i] = t.angle;
        arr[2 * i + 1] = m.forceMax > 0 ? AURA_RMAX * Math.min(1, Math.max(0, t.force / m.forceMax)) : 0;
      }
      for (let i = n; i < TICK_CAPACITY; i++) arr[2 * i + 1] = -10;
      this.tickAttr.needsUpdate = true;
      this.tickGeo.instanceCount = n;
    }
    this.texture.needsUpdate = true;
    this.scheduler.requestOnce();
  }

  setCentre(x: number, y: number): void { this.group.position.set(x, y, 0); this.scheduler.requestOnce(); }

  setTheme(tokens: TokenSet): void {
    (this.decalMat.uniforms['uHold']!.value as THREE_NS.Color).set(tokens.hold);
    (this.decalMat.uniforms['uBreak']!.value as THREE_NS.Color).set(tokens.break);
    (this.decalMat.uniforms['uInk']!.value as THREE_NS.Color).set(tokens.ink);
    (this.tickMat.uniforms['uBreak']!.value as THREE_NS.Color).set(tokens.break);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.decal.geometry.dispose();
    this.decalMat.dispose();
    this.tickGeo.dispose();
    this.tickMat.dispose();
    this.texture.dispose();
  }
}
