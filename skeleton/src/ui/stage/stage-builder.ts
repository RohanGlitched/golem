// Builds three.js meshes from a MuJoCo model (geom group 2 only). Reads plain arrays, so tests need no MuJoCo.
import type * as THREE_NS from 'three';

type Three = typeof THREE_NS;

export interface ModelLike {
  nbody: number; ngeom: number;
  geom_type: ArrayLike<number>; geom_group: ArrayLike<number>; geom_bodyid: ArrayLike<number>;
  geom_dataid: ArrayLike<number>; geom_size: ArrayLike<number>;
  geom_pos: ArrayLike<number>; geom_quat: ArrayLike<number>;
  mesh_vertadr: ArrayLike<number>; mesh_vertnum: ArrayLike<number>;
  mesh_faceadr: ArrayLike<number>; mesh_facenum: ArrayLike<number>;
  mesh_normaladr?: ArrayLike<number>;
  mesh_vert: ArrayLike<number>; mesh_normal?: ArrayLike<number>;
  mesh_face: ArrayLike<number>; mesh_facenormal?: ArrayLike<number>;
}

export interface FloorSpec { geom: number; halfExtent: number; pos: [number, number, number] }

export interface GeomInfo { geom: number; body: number; mesh: THREE_NS.Mesh; local: Float32Array }

export interface StageParts {
  root: THREE_NS.Group;
  bodyGroups: THREE_NS.Group[];
  meshes: THREE_NS.Mesh[];
  geomInfo: GeomInfo[];
  floor?: FloorSpec;
  skipped: { geom: number; reason: 'group' | 'type' | 'empty-mesh'; type?: number }[];
  warnings: string[];
  meshCount: number;
}

export const GEOM = { plane: 0, hfield: 1, sphere: 2, capsule: 3, ellipsoid: 4, cylinder: 5, box: 6, mesh: 7, sdf: 8 } as const;
export const VISUAL_GROUP = 2;
export const FLOOR_MIN_HALF = 20;

const n = (a: ArrayLike<number> | undefined, i: number): number => (a ? (a[i] as number) : 0);

function meshGeometry(T: Three, m: ModelLike, id: number): THREE_NS.BufferGeometry | undefined {
  const facenum = n(m.mesh_facenum, id);
  if (!(facenum > 0)) return undefined;
  const vadr = n(m.mesh_vertadr, id), fadr = n(m.mesh_faceadr, id);
  const hasNormals = !!(m.mesh_normal && m.mesh_facenormal && m.mesh_normaladr && m.mesh_normal.length > 0);
  const nadr = hasNormals ? n(m.mesh_normaladr, id) : 0;
  const pos = new Float32Array(facenum * 9);
  const nor = new Float32Array(facenum * 9);
  for (let f = 0; f < facenum; f++) {
    for (let c = 0; c < 3; c++) {
      const corner = 3 * (fadr + f) + c;
      const v = vadr + n(m.mesh_face, corner);
      const o = 9 * f + 3 * c;
      pos[o] = n(m.mesh_vert, 3 * v); pos[o + 1] = n(m.mesh_vert, 3 * v + 1); pos[o + 2] = n(m.mesh_vert, 3 * v + 2);
      if (hasNormals) {
        const k = nadr + n(m.mesh_facenormal, corner);
        nor[o] = n(m.mesh_normal, 3 * k); nor[o + 1] = n(m.mesh_normal, 3 * k + 1); nor[o + 2] = n(m.mesh_normal, 3 * k + 2);
      }
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  if (hasNormals) g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  else g.computeVertexNormals();
  return g;
}

function primitive(T: Three, type: number, sx: number, sy: number, sz: number): THREE_NS.BufferGeometry | undefined {
  switch (type) {
    case GEOM.box: return new T.BoxGeometry(2 * sx, 2 * sy, 2 * sz);
    case GEOM.sphere: return new T.SphereGeometry(sx, 24, 16);
    case GEOM.capsule: return new T.CapsuleGeometry(sx, 2 * sy, 6, 16).rotateX(Math.PI / 2);
    case GEOM.cylinder: return new T.CylinderGeometry(sx, sx, 2 * sy, 24).rotateX(Math.PI / 2);
    case GEOM.ellipsoid: return new T.SphereGeometry(1, 24, 16).scale(sx, sy, sz);
    default: return undefined;
  }
}

export function buildStage(m: ModelLike, T: Three, material: THREE_NS.Material): StageParts {
  const root = new T.Group();
  root.name = 'golem-hero';
  const bodyGroups: THREE_NS.Group[] = [];
  for (let b = 0; b < m.nbody; b++) {
    const g = new T.Group();
    g.name = `body:${b}`;
    g.userData['bodyId'] = b;
    bodyGroups.push(g);
    root.add(g);
  }
  const parts: StageParts = { root, bodyGroups, meshes: [], geomInfo: [], skipped: [], warnings: [], meshCount: 0 };
  const supported = new Set<number>([GEOM.plane, GEOM.sphere, GEOM.capsule, GEOM.ellipsoid, GEOM.cylinder, GEOM.box, GEOM.mesh]);
  for (let g = 0; g < m.ngeom; g++) {
    const type = n(m.geom_type, g);
    if (n(m.geom_group, g) !== VISUAL_GROUP) { parts.skipped.push({ geom: g, reason: 'group' }); continue; }
    if (!supported.has(type)) {
      parts.skipped.push({ geom: g, reason: 'type', type });
      parts.warnings.push(`Skipped geom ${g}: geom type ${type} is not supported by the stage`);
      continue;
    }
    const sx = n(m.geom_size, 3 * g), sy = n(m.geom_size, 3 * g + 1), sz = n(m.geom_size, 3 * g + 2);
    if (type === GEOM.plane) {
      if (!parts.floor) {
        parts.floor = {
          geom: g, halfExtent: Math.max(sx, sy, FLOOR_MIN_HALF),
          pos: [n(m.geom_pos, 3 * g), n(m.geom_pos, 3 * g + 1), n(m.geom_pos, 3 * g + 2)],
        };
      }
      continue;
    }
    let geometry: THREE_NS.BufferGeometry | undefined;
    if (type === GEOM.mesh) {
      geometry = meshGeometry(T, m, n(m.geom_dataid, g));
      if (!geometry) {
        parts.skipped.push({ geom: g, reason: 'empty-mesh', type });
        parts.warnings.push(`Skipped geom ${g}: its mesh has no faces`);
        continue;
      }
    } else geometry = primitive(T, type, sx, sy, sz) as THREE_NS.BufferGeometry;
    const mesh = new T.Mesh(geometry, material);
    const body = n(m.geom_bodyid, g);
    const px = n(m.geom_pos, 3 * g), py = n(m.geom_pos, 3 * g + 1), pz = n(m.geom_pos, 3 * g + 2);
    const qw = n(m.geom_quat, 4 * g), qx = n(m.geom_quat, 4 * g + 1), qy = n(m.geom_quat, 4 * g + 2), qz = n(m.geom_quat, 4 * g + 3);
    mesh.position.set(px, py, pz);
    mesh.quaternion.set(qx, qy, qz, qw);
    mesh.userData['bodyId'] = body;
    mesh.userData['geom'] = g;
    mesh.updateMatrix();
    const local = new Float32Array(16);
    mesh.matrix.toArray(local);
    (bodyGroups[body] ?? root).add(mesh);
    parts.meshes.push(mesh);
    parts.geomInfo.push({ geom: g, body, mesh, local });
  }
  parts.meshCount = parts.meshes.length;
  return parts;
}

/** Bounding radius of the drawn hero around its base, from the current body group poses. */
export function boundingRadius(T: Three, parts: StageParts): { radius: number; centre: THREE_NS.Vector3; height: number } {
  parts.root.updateMatrixWorld(true);
  const box = new T.Box3();
  for (const mesh of parts.meshes) box.expandByObject(mesh);
  if (box.isEmpty()) return { radius: 1, centre: new T.Vector3(0, 0, 0.5), height: 1 };
  const s = new T.Sphere();
  box.getBoundingSphere(s);
  return { radius: Math.max(0.3, s.radius), centre: s.center, height: Math.max(0.1, box.max.z) };
}
