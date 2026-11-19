// Trail_Store: the long exposure. One downsampled path of the primary body per trial, in fixed-size typed arrays,
// written out as line-segment vertices for one merged geometry. Pure; allocates only in the constructor.
export const TRAIL_CAPACITY = 2048;
export const TRAIL_POINTS = 32;

export type RGB = readonly [number, number, number];

export class TrailStore {
  readonly pts: Float32Array;
  readonly len: Uint8Array;
  readonly broken: Uint8Array;
  count = 0;
  /** Trials not kept because the store was full. */
  dropped = 0;

  constructor(readonly capacity = TRAIL_CAPACITY, readonly points = TRAIL_POINTS) {
    this.pts = new Float32Array(capacity * points * 3);
    this.len = new Uint8Array(capacity);
    this.broken = new Uint8Array(capacity);
  }

  /** Vertices `writeSegments` can write at most. */
  get maxVertices(): number { return this.capacity * (this.points - 1) * 2; }

  /**
   * Adds the path of `body` from pose frames (per frame: nbody × x, y, z, qw, qx, qy, qz), up to the first frame
   * that is not finite, downsampled to at most `points` points with the first and last kept. Returns false when the
   * path has fewer than 2 points or the store is full.
   */
  add(frames: Float32Array, nbody: number, body: number, broken: boolean): boolean {
    const per = nbody * 7;
    if (!(per > 0) || body < 0 || body >= nbody) return false;
    const fc = Math.floor(frames.length / per);
    let valid = 0;
    while (valid < fc) {
      const o = valid * per + body * 7;
      if (!Number.isFinite(frames[o] as number) || !Number.isFinite(frames[o + 1] as number) || !Number.isFinite(frames[o + 2] as number)) break;
      valid++;
    }
    if (valid < 2) return false;
    if (this.count >= this.capacity) { this.dropped++; return false; }
    const k = valid < this.points ? valid : this.points;
    const base = this.count * this.points * 3;
    for (let j = 0; j < k; j++) {
      const f = Math.round((j * (valid - 1)) / (k - 1));
      const o = f * per + body * 7;
      this.pts[base + 3 * j] = frames[o] as number;
      this.pts[base + 3 * j + 1] = frames[o + 1] as number;
      this.pts[base + 3 * j + 2] = frames[o + 2] as number;
    }
    this.len[this.count] = k;
    this.broken[this.count] = broken ? 1 : 0;
    this.count++;
    return true;
  }

  clear(): void { this.count = 0; this.dropped = 0; }

  /** Writes two vertices per segment into pos and col (3 floats each) and returns the vertex count. No allocation. */
  writeSegments(pos: Float32Array, col: Float32Array, held: RGB, brokenColour: RGB): number {
    let v = 0;
    const max = Math.min(pos.length, col.length) / 3;
    for (let t = 0; t < this.count; t++) {
      const k = this.len[t] as number;
      const c = this.broken[t] === 1 ? brokenColour : held;
      const base = t * this.points * 3;
      for (let j = 0; j + 1 < k; j++) {
        if (v + 2 > max) return v;
        for (let e = 0; e < 2; e++) {
          const src = base + 3 * (j + e);
          pos[3 * v] = this.pts[src] as number; pos[3 * v + 1] = this.pts[src + 1] as number; pos[3 * v + 2] = this.pts[src + 2] as number;
          col[3 * v] = c[0]; col[3 * v + 1] = c[1]; col[3 * v + 2] = c[2];
          v++;
        }
      }
    }
    return v;
  }

  brokenCount(): number { let n = 0; for (let i = 0; i < this.count; i++) n += this.broken[i] as number; return n; }
}
