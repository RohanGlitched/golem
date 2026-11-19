// Ghost_Swarm: up to 64 translucent copies of the robot, one InstancedMesh per drawn geom plus one
// for the push arrows. Slot data is struct-of-arrays; update() writes preallocated arrays only.
import type * as THREE_NS from 'three';
import { clusterSimplify, ghostCell } from './ghost-lod.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { nlerp, writeMatrixTRS } from '../core/pose-math.js';
import type { ThemeName, TokenSet, TrialResult, V3 } from '../types.js';
import type { StageParts } from '../stage/stage-builder.js';
import { crowdFactor, GHOST_RENDER_ORDER, createGhostMaterial, setGhostTheme } from './ghost-shader.js';
import { RETIRE_S, evalGhost, newGhostEval, retireFactor } from './ghost-state.js';
import type { GhostRecord } from './ghost-state.js';
import type { ResolvedArrow } from './push-arrow.js';

type Three = typeof THREE_NS;

export const CAPACITY = 64;
/** HIDDEN: a broken ghost that has faded out but keeps its slot until the next generation, so the scrubber can go back. */
const FREE = 0, STAGED = 1, PLAYING = 2, RETIRING = 3, HIDDEN = 4;

export interface GhostMeta {
  robustness: number;
  worstAt: number;
  warmup: number;
  arrow?: ResolvedArrow | undefined;
}

export interface SwarmOptions {
  nbody: number;
  tokens: TokenSet;
  theme: ThemeName;
  riseDepth: number;
  reducedMotion(): boolean;
  warn(msg: string): void;
  scheduler?: { acquire(r: 'ghosts-running'): void; release(r: 'ghosts-running'): void; requestOnce?(): void };
  capacity?: number;
  /**
   * A playing ghost reached its break time (once per ghost): slot, root-body position at that instant, and whether it
   * is the first ghost of its generation to break. Called from `update`; must not allocate.
   */
  onBreak?(slot: number, x: number, y: number, z: number, first: boolean): void;
}

/** column-major 4x4 product out = a * b, scalar only. */
function mul4(out: Float32Array, o: number, a: Float32Array, ao: number, b: Float32Array, bo: number): void {
  for (let c = 0; c < 4; c++) {
    const b0 = b[bo + 4 * c] as number, b1 = b[bo + 4 * c + 1] as number, b2 = b[bo + 4 * c + 2] as number, b3 = b[bo + 4 * c + 3] as number;
    for (let r = 0; r < 4; r++) {
      out[o + 4 * c + r] = (a[ao + r] as number) * b0 + (a[ao + 4 + r] as number) * b1 + (a[ao + 8 + r] as number) * b2 + (a[ao + 12 + r] as number) * b3;
    }
  }
}


/** Triangle count above which a ghost gets a clustered low-detail copy of the hero mesh. */
export const GHOST_LOD_MIN_TRIS = 600;

/** The hero geometry for small meshes; a vertex-clustered copy for big ones (ghosts are rim-lit outlines). */
export function ghostGeometry(T: typeof THREE_NS, src: THREE_NS.BufferGeometry): THREE_NS.BufferGeometry {
  const pos = src.getAttribute('position');
  if (!pos) return src;
  const tris = src.index ? src.index.count / 3 : pos.count / 3;
  if (tris <= GHOST_LOD_MIN_TRIS) return src;
  src.computeBoundingBox();
  const bb = src.boundingBox!;
  const diag = Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  const out = clusterSimplify(pos.array as ArrayLike<number>, src.index ? (src.index.array as ArrayLike<number>) : null, ghostCell(diag));
  if (out.index.length < 12) return src;
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(out.positions, 3));
  g.setIndex(new T.BufferAttribute(out.index, 1));
  g.computeVertexNormals();
  g.userData['ghostLod'] = true;
  return g;
}

export class GhostSwarm {
  readonly capacity: number;
  readonly meshes: THREE_NS.InstancedMesh[] = [];
  readonly arrowMesh: THREE_NS.InstancedMesh;
  readonly group: THREE_NS.Group;
  readonly material: THREE_NS.ShaderMaterial;
  private readonly arrowGeometry: THREE_NS.BufferGeometry;
  private readonly state: THREE_NS.InstancedBufferAttribute;
  private readonly arrowState: THREE_NS.InstancedBufferAttribute;
  private readonly geomBody: Int32Array;
  private readonly geomLocal: Float32Array;
  private readonly nbody: number;

  // struct-of-arrays slot data
  readonly stage: Uint8Array;
  readonly robust: Float64Array;
  readonly tWorst: Float64Array;
  readonly warmup: Float64Array;
  readonly fps: Float64Array;
  readonly frameCount: Int32Array;
  readonly validFrames: Int32Array;
  readonly genStart: Float64Array;
  readonly arrivedAt: Float64Array;
  readonly retireAt: Float64Array;
  readonly gen: Int32Array;
  readonly frames: (Float32Array | null)[];
  readonly arrows: (ResolvedArrow | undefined)[];

  private readonly bodyMats: Float32Array;
  private readonly pose = new Float64Array(7);
  private readonly ev = newGhostEval();
  private readonly rec: GhostRecord = { robustness: 0, worstAt: 0, warmup: 0, fps: 30, frameCount: 1, validFrames: 1 };
  private nextSlot = 0;
  private genId = 0;
  private highest = -1;
  /** Highest slot that is not free (hidden slots included). */
  private span = -1;
  private readonly brokeSeen: Uint8Array;
  private genBroke = false;
  private frozen = false;
  /** Swarm time at which the current generation started playing, and its longest recording (s). */
  playStart = 0;
  playDuration = 0;
  /** Id of the generation that last started playing. */
  private playGen = -1;
  /** Mean xy of body 1 (the root body) over visible ghosts, or null when none is visible. */
  centroid: [number, number] | null = null;
  private readonly centroidBuf: [number, number] = [0, 0];
  private running = false;
  private now = 0;
  disposed = false;

  constructor(parts: StageParts, private readonly T: Three, private readonly o: SwarmOptions) {
    const cap = (this.capacity = o.capacity ?? CAPACITY);
    this.nbody = o.nbody;
    this.group = new T.Group();
    this.group.name = 'golem-ghosts';
    this.material = createGhostMaterial(T, o.tokens, o.theme, o.riseDepth);
    this.state = new T.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.state.setUsage(T.DynamicDrawUsage);
    this.arrowState = new T.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.arrowState.setUsage(T.DynamicDrawUsage);
    const ng = parts.geomInfo.length;
    this.geomBody = new Int32Array(ng);
    this.geomLocal = new Float32Array(16 * ng);
    parts.geomInfo.forEach((gi, i) => {
      this.geomBody[i] = gi.body;
      this.geomLocal.set(gi.local, 16 * i);
      const geometry = ghostGeometry(T, gi.mesh.geometry);
      geometry.setAttribute('aState', this.state);
      const im = new T.InstancedMesh(geometry, this.material, cap);
      im.instanceMatrix.setUsage(T.DynamicDrawUsage);
      im.frustumCulled = false;
      im.renderOrder = GHOST_RENDER_ORDER;
      im.count = 0;
      im.name = `ghost:${gi.geom}`;
      this.meshes.push(im);
      this.group.add(im);
    });
    const shaft = new T.CylinderGeometry(0.012, 0.012, 0.8, 8).rotateZ(-Math.PI / 2).translate(0.4, 0, 0);
    const head = new T.ConeGeometry(0.035, 0.2, 12).rotateZ(-Math.PI / 2).translate(0.9, 0, 0);
    this.arrowGeometry = mergeGeometries([shaft, head]) as THREE_NS.BufferGeometry;
    shaft.dispose(); head.dispose();
    this.arrowGeometry.setAttribute('aState', this.arrowState);
    this.arrowMesh = new T.InstancedMesh(this.arrowGeometry, this.material, cap);
    this.arrowMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.arrowMesh.frustumCulled = false;
    this.arrowMesh.renderOrder = GHOST_RENDER_ORDER + 1;
    this.arrowMesh.count = 0;
    this.group.add(this.arrowMesh);

    this.stage = new Uint8Array(cap);
    this.robust = new Float64Array(cap);
    this.tWorst = new Float64Array(cap);
    this.warmup = new Float64Array(cap);
    this.fps = new Float64Array(cap);
    this.frameCount = new Int32Array(cap);
    this.validFrames = new Int32Array(cap);
    this.genStart = new Float64Array(cap);
    this.arrivedAt = new Float64Array(cap);
    this.retireAt = new Float64Array(cap);
    this.gen = new Int32Array(cap).fill(-1);
    this.frames = new Array<Float32Array | null>(cap).fill(null);
    this.arrows = new Array<ResolvedArrow | undefined>(cap).fill(undefined);
    this.bodyMats = new Float32Array(16 * this.nbody);
    this.brokeSeen = new Uint8Array(cap);
  }

  /** Ghosts currently held in a slot (staged, playing or retiring; not the faded ones kept for scrubbing). */
  get shown(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.stage[i] !== FREE && this.stage[i] !== HIDDEN) n++;
    return n;
  }

  /** True while the current generation has slots to scrub (playing or faded). */
  get scrubbable(): boolean {
    for (let i = 0; i <= this.span; i++) { const st = this.stage[i]; if ((st === PLAYING || st === HIDDEN) && this.gen[i] === this.playGen) return true; }
    return false;
  }

  /** Frozen: the swarm holds no render reason and draws only when asked (the timeline scrubber). */
  setFrozen(f: boolean): void {
    if (f === this.frozen) return;
    this.frozen = f;
    if (f) this.setRunning(false);
    else if (this.shown > 0) this.setRunning(true);
  }

  get isFrozen(): boolean { return this.frozen; }

  get count(): number { return this.highest + 1; }

  beginGeneration(): void { this.nextSlot = 0; this.genId++; }

  /** Stages one result. The first 64 of a Generation get slots; the rest are counted elsewhere. */
  accept(r: TrialResult, meta: GhostMeta, nowSec = this.now): 'ok' | 'ignored-full' | 'rejected' {
    const p = r.poses;
    if (!p) return 'rejected';
    if (p.nbody !== this.nbody) {
      this.o.warn(`Ghost rejected: result has nbody ${p.nbody} but the model has ${this.nbody}`);
      return 'rejected';
    }
    const per = p.nbody * 7;
    if (per === 0 || p.frames.length === 0 || p.frames.length % per !== 0) {
      this.o.warn(`Ghost rejected: pose array length ${p.frames.length} is not a multiple of nbody × 7 = ${per}`);
      return 'rejected';
    }
    const fc = p.frames.length / per;
    let valid = fc;
    for (let f = 0; f < fc && valid === fc; f++) {
      for (let k = f * per; k < (f + 1) * per; k++) if (!Number.isFinite(p.frames[k] as number)) { valid = f; break; }
    }
    if (valid === 0) {
      this.o.warn('Ghost rejected: the first pose frame is not finite');
      return 'rejected';
    }
    if (this.nextSlot >= this.capacity) return 'ignored-full';
    const s = this.nextSlot++;
    this.stage[s] = STAGED;
    this.gen[s] = this.genId;
    this.robust[s] = meta.robustness;
    this.tWorst[s] = meta.worstAt;
    this.warmup[s] = meta.warmup;
    this.fps[s] = p.fps > 0 ? p.fps : 30;
    this.frameCount[s] = fc;
    this.validFrames[s] = valid;
    this.frames[s] = p.frames;
    this.arrows[s] = meta.arrow;
    this.arrivedAt[s] = nowSec;
    this.genStart[s] = 0;
    this.brokeSeen[s] = 0;
    if (s > this.highest) this.highest = s;
    if (s > this.span) this.span = s;
    if (this.frozen) this.o.scheduler?.requestOnce?.();
    else this.setRunning(true);
    return 'ok';
  }

  /** All staged ghosts of this Generation start playing from one clock; leftover slots retire over 300 ms. */
  commitGeneration(clockStartSec: number): void {
    let started = false;
    let dur = 0;
    for (let s = 0; s < this.capacity; s++) {
      const st = this.stage[s];
      if (st === STAGED && this.gen[s] === this.genId) {
        this.stage[s] = PLAYING; this.genStart[s] = clockStartSec; started = true;
        const fc = this.frameCount[s] as number, fps = this.fps[s] as number;
        const T = fc > 1 && fps > 0 ? (fc - 1) / fps : 0;
        if (T > dur) dur = T;
      } else if (st === HIDDEN && this.gen[s] !== this.genId) this.free(s);
      else if ((st === PLAYING || st === STAGED) && this.gen[s] !== this.genId) { this.stage[s] = RETIRING; this.retireAt[s] = clockStartSec; }
    }
    if (started) { this.playStart = clockStartSec; this.playDuration = dur; this.genBroke = false; this.playGen = this.genId; }
    if (this.frozen) this.o.scheduler?.requestOnce?.();
    else this.setRunning(this.shown > 0);
  }

  /** Cancel: hide every ghost now. */
  clear(): void {
    for (let s = 0; s < this.capacity; s++) this.free(s);
    this.highest = -1;
    this.span = -1;
    this.nextSlot = 0;
    this.playDuration = 0;
    for (const m of this.meshes) m.count = 0;
    this.arrowMesh.count = 0;
    this.setRunning(false);
  }

  private free(s: number): void {
    this.stage[s] = FREE;
    this.frames[s] = null;
    this.arrows[s] = undefined;
    this.gen[s] = -1;
    (this.state.array as Float32Array)[4 * s + 1] = 0;
    (this.arrowState.array as Float32Array)[4 * s + 1] = 0;
  }

  private setRunning(on: boolean): void {
    if (on === this.running) return;
    this.running = on;
    if (on) this.o.scheduler?.acquire('ghosts-running');
    else this.o.scheduler?.release('ghosts-running');
  }

  /** Ghost time of a slot: 0 while staged, max(0, now - start) once its Generation plays. */
  timeOf(slot: number, nowSec: number): number {
    const st = this.stage[slot];
    if (st === PLAYING || st === RETIRING || st === HIDDEN) { const t = nowSec - (this.genStart[slot] as number); return t > 0 ? t : 0; }
    return 0;
  }

  /** Writes instance matrices and states. Returns true while anything animates. */
  update(nowSec: number): boolean {
    this.now = nowSec;
    const reduced = this.o.reducedMotion();
    const st = this.state.array as Float32Array;
    const ast = this.arrowState.array as Float32Array;
    const nb = this.nbody;
    const ng = this.geomBody.length;
    const rootBody = nb > 1 ? 1 : 0;
    let high = -1;
    let span = -1;
    let any = false;
    let cx = 0, cy = 0, cn = 0, visible = 0;
    for (let s = 0; s <= this.span; s++) {
      let stage = this.stage[s];
      if (stage === FREE) { st[4 * s + 1] = 0; ast[4 * s + 1] = 0; continue; }
      const frames = this.frames[s] as Float32Array;
      const tau = this.timeOf(s, nowSec);
      const rec = this.rec;
      rec.robustness = this.robust[s] as number; rec.worstAt = this.tWorst[s] as number; rec.warmup = this.warmup[s] as number;
      rec.fps = this.fps[s] as number; rec.frameCount = this.frameCount[s] as number; rec.validFrames = this.validFrames[s] as number;
      const ev = evalGhost(rec, tau, reduced, this.ev, nowSec - (this.arrivedAt[s] as number));
      let opacity = ev.opacity;
      if (stage === RETIRING) {
        const since = nowSec - (this.retireAt[s] as number);
        opacity *= retireFactor(since, reduced);
        if (reduced || since >= RETIRE_S) { this.free(s); continue; }
      }
      if (ev.hidden) {
        // A faded broken ghost of the current generation keeps its slot for the scrubber.
        if ((stage === PLAYING || stage === HIDDEN) && this.gen[s] === this.playGen) {
          this.stage[s] = HIDDEN; st[4 * s + 1] = 0; ast[4 * s + 1] = 0; span = s;
          const o = (ev.frame * nb + rootBody) * 7;
          this.noteBreak(s, ev.breakMix, frames[o] as number, frames[o + 1] as number, frames[o + 2] as number);
          continue;
        }
        this.free(s); continue;
      }
      if (stage === HIDDEN) { this.stage[s] = stage = PLAYING; }
      high = s;
      span = s;
      // A survivor holding its last frame is static: it stays visible but needs no more frames.
      const T = rec.frameCount > 1 ? (rec.frameCount - 1) / rec.fps : 0;
      if (stage !== PLAYING || tau < T || ev.rise > 0 || (rec.robustness < 0 && opacity > 0)) any = true;
      let rx = 0, ry = 0, rz = 0;
      for (let b = 0; b < nb; b++) {
        nlerp(frames, nb, ev.frame, ev.next, b, ev.alpha, this.pose);
        const p = this.pose;
        writeMatrixTRS(this.bodyMats, 16 * b, p[0] as number, p[1] as number, p[2] as number, p[3] as number, p[4] as number, p[5] as number, p[6] as number);
        if (b === rootBody) { rx = p[0] as number; ry = p[1] as number; rz = p[2] as number; }
        if (b === 1 && opacity > 0.05) { cx += p[0] as number; cy += p[1] as number; cn++; }
      }
      if (stage === PLAYING) this.noteBreak(s, ev.breakMix, rx, ry, rz);
      for (let g = 0; g < ng; g++) {
        const m = this.meshes[g] as THREE_NS.InstancedMesh;
        mul4(m.instanceMatrix.array as Float32Array, 16 * s, this.bodyMats, 16 * (this.geomBody[g] as number), this.geomLocal, 16 * g);
      }
      if (opacity > 0.01) visible++;
      st[4 * s] = ev.breakMix; st[4 * s + 1] = opacity; st[4 * s + 2] = ev.rise; st[4 * s + 3] = 0;
      const a = this.arrows[s];
      if (a && tau <= a.tEnd && stage !== RETIRING) {
        this.writeArrow(s, a, frames);
        ast[4 * s] = ev.breakMix; ast[4 * s + 1] = opacity; ast[4 * s + 2] = ev.rise; ast[4 * s + 3] = 0;
      } else ast[4 * s + 1] = 0;
    }
    this.highest = high;
    this.span = span;
    if (cn > 0) { this.centroidBuf[0] = cx / cn; this.centroidBuf[1] = cy / cn; this.centroid = this.centroidBuf; } else this.centroid = null;
    this.material.uniforms['uCrowd']!.value = crowdFactor(visible);
    for (const m of this.meshes) { m.count = high + 1; m.instanceMatrix.needsUpdate = true; }
    this.arrowMesh.count = high + 1;
    this.arrowMesh.instanceMatrix.needsUpdate = true;
    this.state.needsUpdate = true;
    this.arrowState.needsUpdate = true;
    if (!any || this.frozen) this.setRunning(false);
    return any;
  }

  /** Calls onBreak once per ghost when its break time is crossed; the first of a generation is flagged. */
  private noteBreak(s: number, breakMix: number, x: number, y: number, z: number): void {
    if (breakMix !== 1 || this.brokeSeen[s] === 1 || this.gen[s] !== this.playGen) return;
    this.brokeSeen[s] = 1;
    const first = !this.genBroke;
    this.genBroke = true;
    this.o.onBreak?.(s, x, y, z, first);
  }

  /** T(start) * R(+X -> dir) * S(length, 1, 1), start at the body position in frame 0. */
  private writeArrow(s: number, a: ResolvedArrow, frames: Float32Array): void {
    const o = a.body * 7;
    const px = frames[o] as number, py = frames[o + 1] as number, pz = frames[o + 2] as number;
    const [dx, dy, dz] = a.dir as V3;
    // shortest arc from +X to d: q = normalize(1 + dx, 0, -dz, dy) in (w, x, y, z)
    let qw = 1 + dx, qx = 0, qy = -dz, qz = dy;
    const n = Math.hypot(qw, qx, qy, qz);
    if (n < 1e-9) { qw = 0; qx = 0; qy = 0; qz = 1; } else { qw /= n; qy /= n; qz /= n; }
    const out = this.arrowMesh.instanceMatrix.array as Float32Array;
    const base = 16 * s;
    const L = a.length;
    writeMatrixTRS(out, base, px, py, pz, qx, qy, qz, qw);
    out[base] = (out[base] as number) * L; out[base + 1] = (out[base + 1] as number) * L; out[base + 2] = (out[base + 2] as number) * L;
  }

  setTheme(tokens: TokenSet, theme: ThemeName): void { setGhostTheme(this.T, this.material, tokens, theme); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const m of this.meshes) { if (m.geometry.userData['ghostLod']) m.geometry.dispose(); else m.geometry.deleteAttribute('aState'); m.dispose(); }
    this.arrowMesh.dispose();
    this.arrowGeometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
