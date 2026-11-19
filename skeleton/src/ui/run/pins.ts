// Pinned seeds in localStorage, with an in-memory fallback.
import { counterexampleFrom, seedToJson } from './seed-json.js';
import type { Counterexample } from '../types.js';

export const PINS_MEMORY_TEXT = "Pins can't be saved in this browser and will be lost on reload";

export const pinKey = (appId: string, reqId: string): string => `golem:pins:v1:${appId}:${reqId}`;

/** The golem-falsify equality rule: same reqId, same seed, equal values for every dimension name. */
export function sameCounterexample(a: Counterexample, b: Counterexample): boolean {
  if (a.reqId !== b.reqId || a.seed !== b.seed) return false;
  const ka = Object.keys(a.scenario), kb = Object.keys(b.scenario);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!(k in b.scenario)) return false;
    if (!Object.is(a.scenario[k] === 0 ? 0 : a.scenario[k], b.scenario[k] === 0 ? 0 : b.scenario[k])) return false;
  }
  return true;
}

export class PinnedSeedStore {
  private readonly memory = new Map<string, Counterexample[]>();
  private memoryAnnounced = false;

  constructor(
    private readonly storage: Storage | undefined,
    private readonly warn: (msg: string) => void,
    private readonly announce: (msg: string) => void = warn,
  ) {}

  private parse(raw: string | null, reqId: string): Counterexample[] {
    if (raw === null) return [];
    let arr: unknown;
    try { arr = JSON.parse(raw); } catch { this.warn(`Ignored the pinned seeds of ${reqId}: they are not valid JSON`); return []; }
    if (!Array.isArray(arr)) { this.warn(`Ignored the pinned seeds of ${reqId}: they are not a list`); return []; }
    const out: Counterexample[] = [];
    let bad = 0;
    for (const e of arr) {
      const r = counterexampleFrom(e);
      if (r.ok && r.value.reqId === reqId) out.push(r.value); else bad++;
    }
    if (bad > 0) this.warn(`Ignored ${bad} invalid pinned seed${bad === 1 ? '' : 's'} for ${reqId}`);
    return out;
  }

  read(appId: string, reqId: string): Counterexample[] {
    const key = pinKey(appId, reqId);
    const mem = this.memory.get(key);
    if (mem) return mem.slice();
    let raw: string | null = null;
    try { raw = this.storage ? this.storage.getItem(key) : null; } catch { raw = null; }
    return this.parse(raw, reqId);
  }

  private write(key: string, list: Counterexample[]): boolean {
    if (this.storage && !this.memory.has(key)) {
      try { this.storage.setItem(key, `[${list.map(seedToJson).join(',')}]`); return true; } catch { /* fall through */ }
    }
    this.memory.set(key, list);
    if (!this.memoryAnnounced) { this.memoryAnnounced = true; this.announce(PINS_MEMORY_TEXT); }
    return false;
  }

  pin(appId: string, ce: Counterexample): 'added' | 'duplicate' | 'memory-only' {
    const list = this.read(appId, ce.reqId);
    if (list.some((p) => sameCounterexample(p, ce))) return 'duplicate';
    list.push(ce);
    return this.write(pinKey(appId, ce.reqId), list) ? 'added' : 'memory-only';
  }

  remove(appId: string, ce: Counterexample): void {
    const list = this.read(appId, ce.reqId).filter((p) => !sameCounterexample(p, ce));
    this.write(pinKey(appId, ce.reqId), list);
  }
}
