// Unfired clay under one raking lamp. Procedural grain, no texture, no time term.
import type * as THREE_NS from 'three';
import type { TokenSet } from '../types.js';

type Three = typeof THREE_NS;

export const KEY_AZIMUTH_DEG = 35;
export const KEY_ELEVATION_DEG = 15;
export const FILL_AZIMUTH_DEG = 215;
export const FILL_ELEVATION_DEG = 40;
export const KEY_INTENSITY = 0.85;
export const FILL_INTENSITY = 0.28;
export const AMBIENT = 0.12;
export const WRAP = 0.5;
export const GRAIN_AMPLITUDE = 0.06;
export const GRAIN_FREQ = 150;

/** Unit vector toward a light at azimuth (from +x, counter-clockwise) and elevation above the floor. z-up. */
export function lightDir(azDeg: number, elDeg: number): [number, number, number] {
  const a = (azDeg * Math.PI) / 180, e = (elDeg * Math.PI) / 180;
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
}

export const CLAY_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vObj;
void main() {
  vObj = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const CLAY_FRAG = /* glsl */ `
uniform vec3 uClay;
uniform vec3 uKeyDir;
uniform vec3 uFillDir;
uniform float uKeyI;
uniform float uFillI;
uniform float uAmb;
uniform float uWrap;
uniform float uGrain;
uniform float uGrainFreq;
varying vec3 vNormalW;
varying vec3 vObj;

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float wrapped(float ndl) { return clamp((ndl + uWrap) / (1.0 + uWrap), 0.0, 1.0); }

void main() {
  vec3 n = normalize(vNormalW);
  float key = wrapped(dot(n, normalize(uKeyDir))) * uKeyI;
  float fill = wrapped(dot(n, normalize(uFillDir))) * uFillI;
  float g = vnoise(vObj * uGrainFreq) * 0.65 + vnoise(vObj * uGrainFreq * 3.1) * 0.35;
  float grain = 1.0 + uGrain * (2.0 * g - 1.0);
  vec3 lit = uClay * (uAmb + key + fill) * grain;
  gl_FragColor = vec4(lit, 1.0);
  #include <colorspace_fragment>
}
`;

export function createClayMaterial(T: Three, tokens: TokenSet): THREE_NS.ShaderMaterial {
  const k = lightDir(KEY_AZIMUTH_DEG, KEY_ELEVATION_DEG);
  const f = lightDir(FILL_AZIMUTH_DEG, FILL_ELEVATION_DEG);
  return new T.ShaderMaterial({
    vertexShader: CLAY_VERT,
    fragmentShader: CLAY_FRAG,
    uniforms: {
      uClay: { value: new T.Color(tokens.clay) },
      uKeyDir: { value: new T.Vector3(k[0], k[1], k[2]) },
      uFillDir: { value: new T.Vector3(f[0], f[1], f[2]) },
      uKeyI: { value: KEY_INTENSITY },
      uFillI: { value: FILL_INTENSITY },
      uAmb: { value: AMBIENT },
      uWrap: { value: WRAP },
      uGrain: { value: GRAIN_AMPLITUDE },
      uGrainFreq: { value: GRAIN_FREQ },
    },
    side: T.FrontSide,
    transparent: false,
    depthWrite: true,
  });
}

export function setClayTheme(m: THREE_NS.ShaderMaterial, tokens: TokenSet): void {
  (m.uniforms['uClay']!.value as THREE_NS.Color).set(tokens.clay);
}
