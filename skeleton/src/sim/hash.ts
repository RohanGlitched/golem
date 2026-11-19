// Trajectory hash (golem-sim-hardening improvement 3). Two 32-bit lanes over the 32-bit words of qpos:
// lane A is FNV-1a over words, lane B is the MurmurHash3 x86_32 body. Both are finalised with fmix32
// after mixing in nq and the number of states. Only Math.imul, shifts and xor are used, and WASM memory
// is little-endian everywhere, so Node, Chrome and Firefox give the same digest for the same trajectory.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const MURMUR_SEED = 0x9747b28c;

function rotl(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

function murmurWord(h: number, w: number): number {
  let k = Math.imul(w, 0xcc9e2d51);
  k = rotl(k, 15);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = rotl(h, 13);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const hex8 = (x: number): string => (x >>> 0).toString(16).padStart(8, '0');

export class TrajectoryHasher {
  private a = FNV_OFFSET;
  private b = MURMUR_SEED;
  private states = 0;

  /** Adds one state: the 32-bit words of qpos (a Uint32Array view on the same bytes). No allocation. */
  update(words: Uint32Array): void {
    let a = this.a;
    let b = this.b;
    for (let i = 0; i < words.length; i++) {
      const w = words[i] as number;
      a = Math.imul(a ^ w, FNV_PRIME);
      b = murmurWord(b, w);
    }
    this.a = a;
    this.b = b;
    this.states++;
  }

  get count(): number { return this.states; }

  /** 16 hex digits. `nq` is mixed in so that models of different sizes cannot collide trivially. */
  digest(nq: number): string {
    let a = this.a;
    let b = this.b;
    a = Math.imul(a ^ (nq >>> 0), FNV_PRIME);
    a = Math.imul(a ^ (this.states >>> 0), FNV_PRIME);
    b = murmurWord(b, nq >>> 0);
    b = murmurWord(b, this.states >>> 0);
    return hex8(fmix32(a)) + hex8(fmix32(b ^ Math.imul(this.states, 4)));
  }
}
