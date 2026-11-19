// The quiet floor: one plane in --ground, no grid, no reflection, no texture; fog fades it into the background.
import type * as THREE_NS from 'three';
import type { TokenSet } from '../types.js';
import { FLOOR_MIN_HALF } from './stage-builder.js';
import type { FloorSpec } from './stage-builder.js';

type Three = typeof THREE_NS;

export const FOG_NEAR = 12;
export const FOG_FAR = 30;

export interface Floor { mesh: THREE_NS.Mesh; material: THREE_NS.MeshBasicMaterial; fog: THREE_NS.Fog; halfExtent: number }

export function createFloor(T: Three, spec: FloorSpec | undefined, tokens: TokenSet): Floor {
  const halfExtent = Math.max(spec?.halfExtent ?? 0, FLOOR_MIN_HALF);
  const material = new T.MeshBasicMaterial({ color: new T.Color(tokens.ground), fog: true });
  const mesh = new T.Mesh(new T.PlaneGeometry(2 * halfExtent, 2 * halfExtent), material);
  mesh.name = 'golem-floor';
  if (spec) mesh.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
  mesh.renderOrder = 0;
  const fog = new T.Fog(new T.Color(tokens.ground), FOG_NEAR, FOG_FAR);
  return { mesh, material, fog, halfExtent };
}

export function setFloorTheme(f: Floor, tokens: TokenSet): void {
  f.material.color.set(tokens.ground);
  f.fog.color.set(tokens.ground);
}
