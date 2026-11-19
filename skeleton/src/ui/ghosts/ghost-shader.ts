// Ghost material: fresnel rim, per-instance state (colour mix, opacity, rise). No time uniform.
import type * as THREE_NS from 'three';
import type { ThemeName, TokenSet } from '../types.js';

type Three = typeof THREE_NS;

export const GHOST_RENDER_ORDER = 10;
export const RIM_POWER = 3.2;
export const RIM_BASE = 0.04;
/** Ghosts that hold fade as the swarm grows (a crowd of 64 must still read as separate figures). */
export const CROWD_FREE = 6;
export const crowdFactor = (visible: number): number => (visible <= CROWD_FREE ? 1 : Math.sqrt(CROWD_FREE / visible));

export const GHOST_VERT = /* glsl */ `
attribute vec4 aState;
uniform float uRiseDepth;
varying vec3 vN;
varying vec3 vV;
varying vec4 vState;
varying float vZ;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  wp.z -= aState.z * uRiseDepth;
  vZ = wp.z;
  vN = normalize(mat3(m) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vState = aState;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const GHOST_FRAG = /* glsl */ `
uniform vec3 uGhost;
uniform vec3 uBreak;
uniform float uRimPower;
uniform float uBase;
uniform float uCrowd;
varying vec3 vN;
varying vec3 vV;
varying vec4 vState;
varying float vZ;
void main() {
  if (vState.y <= 0.001) discard;
  if (vState.z > 0.0 && vZ < 0.0) discard;
  float ndv = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  float rim = pow(1.0 - ndv, uRimPower);
  vec3 col = mix(uGhost, uBreak, vState.x);
  // A breaking ghost keeps full strength so the failure reads through the crowd.
  float a = vState.y * (uBase + (1.0 - uBase) * rim) * mix(uCrowd, 1.0, vState.x);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export function ghostBlending(T: Three, theme: ThemeName): THREE_NS.Blending {
  return theme === 'dark' ? T.AdditiveBlending : T.NormalBlending;
}

export function createGhostMaterial(T: Three, tokens: TokenSet, theme: ThemeName, riseDepth: number): THREE_NS.ShaderMaterial {
  return new T.ShaderMaterial({
    vertexShader: GHOST_VERT,
    fragmentShader: GHOST_FRAG,
    uniforms: {
      uGhost: { value: new T.Color(tokens.ghost) },
      uBreak: { value: new T.Color(tokens.break) },
      uRimPower: { value: RIM_POWER },
      uBase: { value: RIM_BASE },
      uCrowd: { value: 1 },
      uRiseDepth: { value: riseDepth },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: T.FrontSide,
    blending: ghostBlending(T, theme),
  });
}

export function setGhostTheme(T: Three, m: THREE_NS.ShaderMaterial, tokens: TokenSet, theme: ThemeName): void {
  (m.uniforms['uGhost']!.value as THREE_NS.Color).set(tokens.ghost);
  (m.uniforms['uBreak']!.value as THREE_NS.Color).set(tokens.break);
  m.blending = ghostBlending(T, theme);
  m.needsUpdate = true;
}

/** CPU reference of the fragment alpha, for tests. A zero opacity discards (returns undefined). */
export function ghostAlpha(opacity: number, ndv: number, crowd = 1, breakMix = 0): number | undefined {
  if (opacity <= 0.001) return undefined;
  const rim = Math.pow(1 - Math.min(1, Math.max(0, Math.abs(ndv))), RIM_POWER);
  return opacity * (RIM_BASE + (1 - RIM_BASE) * rim) * (crowd + (1 - crowd) * breakMix);
}
