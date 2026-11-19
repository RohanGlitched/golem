import fc from 'fast-check';
import type { ModelLike } from '../../stage/stage-builder.js';

export interface GeomSpec { type: number; group: number; body: number; mesh: number; size: [number, number, number] }

const pos = fc.double({ min: 0.01, max: 2, noNaN: true });

/** Two meshes: mesh 0 a tetrahedron, mesh 1 with zero faces. */
export function modelFrom(nbody: number, geoms: GeomSpec[]): ModelLike {
  const ng = geoms.length;
  const quat = new Float64Array(4 * ng);
  for (let g = 0; g < ng; g++) quat[4 * g] = 1;
  return {
    nbody, ngeom: ng,
    geom_type: Int32Array.from(geoms.map((g) => g.type)),
    geom_group: Int32Array.from(geoms.map((g) => g.group)),
    geom_bodyid: Int32Array.from(geoms.map((g) => g.body)),
    geom_dataid: Int32Array.from(geoms.map((g) => (g.type === 7 ? g.mesh : -1))),
    geom_size: Float64Array.from(geoms.flatMap((g) => g.size)),
    geom_pos: Float64Array.from(geoms.flatMap((_, i) => [0.1 * i, 0, 0.2])),
    geom_quat: quat,
    mesh_vertadr: Int32Array.from([0, 4]),
    mesh_vertnum: Int32Array.from([4, 0]),
    mesh_faceadr: Int32Array.from([0, 4]),
    mesh_facenum: Int32Array.from([4, 0]),
    mesh_normaladr: Int32Array.from([0, 4]),
    mesh_vert: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    mesh_normal: Float32Array.from([0, 0, -1, 0, -1, 0, -1, 0, 0, 0.577, 0.577, 0.577]),
    mesh_face: Int32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
    mesh_facenormal: Int32Array.from([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]),
  };
}

export const arbModel = fc.integer({ min: 1, max: 5 }).chain((nbody) =>
  fc.array(fc.record({
    type: fc.integer({ min: 0, max: 8 }),
    group: fc.constantFrom(0, 1, 2, 2, 2, 3),
    body: fc.integer({ min: 0, max: nbody - 1 }),
    mesh: fc.integer({ min: 0, max: 1 }),
    size: fc.tuple(pos, pos, pos),
  }), { maxLength: 12 }).map((geoms) => ({ nbody, geoms, model: modelFrom(nbody, geoms) })));
