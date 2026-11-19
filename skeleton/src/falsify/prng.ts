// Seeded randomness for the falsifier. Nothing here (or anywhere in engine code) calls Math.random().

/** Bijection on uint32 (murmur3 finalizer). */
export function fmix32(z: number): number {
  z = z >>> 0;
  z ^= z >>> 16; z = Math.imul(z, 0x85ebca6b);
  z ^= z >>> 13; z = Math.imul(z, 0xc2b2ae35);
  z ^= z >>> 16;
  return z >>> 0;
}

/** Uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over UTF-16 code units, then fmix32. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h);
}

/** Phase salts (the `phase` argument of deriveSeed). */
export const SALT = { phase1: 1, phase2: 2, verification: 3, lhs: 4, cem: 5 } as const;

function base(searchSeed: number, phase: number): number {
  return fmix32(((searchSeed >>> 0) ^ Math.imul(phase + 1, 0x9e3779b1)) >>> 0);
}

/**
 * Pure uint32 derived from (searchSeed, phase, index). For fixed (searchSeed, phase) it is injective in
 * `index` over 0 <= index < 2^32: the multiplier is odd and fmix32 is a bijection.
 */
export function deriveSeed(searchSeed: number, phase: number, index: number): number {
  return fmix32((base(searchSeed, phase) + Math.imul(index, 0x9e3779b9)) >>> 0);
}
