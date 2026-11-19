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
uniform float uRmax;
uniform float uOpacity;
varying vec2 vLocal;
const float TAU = 6.28318530718;
void main() {
  float r = length(vLocal);
  float ang = atan(vLocal.y, vLocal.x);
  float u = fract(ang / TAU);
  vec4 t = texture2D(uAura, vec2(u, 0.5));
  float R = t.r * uRmax;
  if (R < 0.004) discard;
  float px = max(fwidth(r), 1e-4);
  float edge = 1.0 - smoothstep(R - 2.0 * px, R, r);
  float ring = smoothstep(R - 3.0 * px, R - 2.0 * px, r) * (1.0 - smoothstep(R - px, R, r));
  float solid = step(0.5, t.g);
  float dash = step(0.5, fract(ang * 90.0 / TAU));
  ring *= mix(dash, 1.0, solid);
  float a = uOpacity * edge + 0.8 * ring;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uHold, a);
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
      },
      transparent: true, depthWrite: false, blending: T.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.decal = new T.Mesh(new T.PlaneGeometry(2 * 1.26, 2 * 1.26), this.decalMat);
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
