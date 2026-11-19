// Test doubles shared by the studio tests.
import { syntheticTrialFields } from '../core/trial-fields.js';
import type { CompiledRequirement, FalsifyFn, TrialPool, TrialResult, TrialSpec, Verdict } from '../types.js';

export class FakeRaf {
  private next = 1;
  private readonly queue = new Map<number, (ts: number) => void>();
  time = 0;
  raf = (cb: (ts: number) => void): number => { const id = this.next++; this.queue.set(id, cb); return id; };
  caf = (id: number): void => { this.queue.delete(id); };
  get pending(): number { return this.queue.size; }
  /** Runs the oldest pending callback. Returns false when none is pending. */
  runNext(dtMs = 16): boolean {
    const first = this.queue.entries().next();
    if (first.done) return false;
    const [id, cb] = first.value;
    this.queue.delete(id);
    this.time += dtMs;
    cb(this.time);
    return true;
  }
}

export class FakeClock {
  t = 0;
  now = (): number => this.t;
  advance(ms: number): void { this.t += ms; }
}

export class FakeMj {
  steps = 0;
  deleted = 0;
  stepLog: number[] = [];
  model: any;
  data: any;
  constructor(public nbody = 3) {
    this.model = { nbody, delete: () => { this.deleted++; } };
    this.data = {
      qpos: new Float64Array(7), qvel: new Float64Array(6), ctrl: new Float64Array(2),
      xfrc_applied: new Float64Array(6 * nbody), xpos: new Float64Array(3 * nbody),
      xquat: new Float64Array(4 * nbody), xipos: new Float64Array(3 * nbody),
      delete: () => { this.deleted++; },
    };
    for (let b = 0; b < nbody; b++) this.data.xquat[4 * b] = 1;
  }
  mj_step = (_m: unknown, d: any): void => {
    this.steps++;
    this.stepLog.push(d.xfrc_applied[0] as number);
  };
}

export class FakePool implements TrialPool {
  size: number;
  closed = false;
  calls: TrialSpec[][] = [];
  constructor(private readonly fn: (s: TrialSpec) => TrialResult, size = 4) { this.size = size; }
  async run(specs: TrialSpec[], onResult?: (r: TrialResult) => void, opts?: { signal?: AbortSignal }): Promise<TrialResult[]> {
    this.calls.push(specs);
    const out: TrialResult[] = [];
    for (const s of specs) {
      if (opts?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const r = this.fn(s);
      out.push(r);
      onResult?.(r);
    }
    return out;
  }
  async close(): Promise<void> { this.closed = true; }
}

export function synthPoses(nbody: number, frames: number, fps = 30): NonNullable<TrialResult['poses']> {
  const f = new Float32Array(nbody * 7 * frames);
  for (let i = 0; i < frames; i++) {
    for (let b = 0; b < nbody; b++) {
      const o = (i * nbody + b) * 7;
      f[o] = b * 0.1; f[o + 1] = 0; f[o + 2] = 1 - 0.01 * i; f[o + 3] = 1;
    }
  }
  return { fps, nbody, frames: f };
}

/** Synthetic robustness: margin shrinks with force. */
export function synthResult(spec: TrialSpec, nbody = 3, frames = 12): TrialResult {
  const force = spec.scenario['push.force'] ?? 0;
  const poses = spec.record === 'poses' ? synthPoses(nbody, frames) : undefined;
  return {
    spec, robustness: 100 - force, worstAt: 0.5, unit: 'N', wallMs: 1,
    ...(poses ? { poses } : {}),
    ...syntheticTrialFields(spec, poses),
  };
}

/** A falsifier that samples `n` random scenarios in generations of `gen`, with a synthetic robustness. */
export const fakeFalsify = (n = 10, gen = 5): FalsifyFn => async (req: CompiledRequirement, pool, _b, seed, o) => {
  let i = 0;
  let closest = { robustness: Infinity, scenario: {} as Record<string, number>, seed: 0 };
  let broke: Verdict['counterexample'];
  for (let g = 0; i < n; g++) {
    if (o.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const specs: TrialSpec[] = [];
    for (let k = 0; k < gen && i + k < n; k++) {
      const scenario: Record<string, number> = {};
      for (const d of req.space.dims) scenario[d.name] = d.min + ((i + k + 1) / (n + 1)) * (d.max - d.min);
      specs.push({ app: 'test', reqId: req.id, scenario, seed: seed + i + k });
    }
    const rs = await pool.run(specs, undefined, o.signal ? { signal: o.signal } : undefined);
    for (const r of rs) {
      if (r.robustness < closest.robustness) closest = { robustness: r.robustness, scenario: r.spec.scenario, seed: r.spec.seed };
      if (r.robustness < 0 && !broke) broke = { reqId: req.id, scenario: r.spec.scenario, seed: r.spec.seed, robustness: r.robustness, shrunk: false, foundAfter: i };
    }
    i += specs.length;
    o.onProgress?.({ phase: 1, generation: g, trials: i });
  }
  return {
    reqId: req.id, status: broke ? 'broken' : 'held', trials: i, randomTrials: i, guidedTrials: 0,
    closest, ...(broke ? { counterexample: broke } : {}), ms: 5,
  };
};

export class FakeStorage implements Storage {
  private m = new Map<string, string>();
  failWrites = false;
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.m.set(k, v);
  }
}

export class FakeMatchMedia {
  matches: Record<string, boolean> = {};
  private listeners = new Map<string, Set<() => void>>();
  fn = (q: string) => {
    const self = this;
    return {
      get matches(): boolean { return self.matches[q] ?? false; },
      addEventListener: (_t: string, cb: () => void) => { (this.listeners.get(q) ?? this.listeners.set(q, new Set()).get(q)!).add(cb); },
      removeEventListener: (_t: string, cb: () => void) => { this.listeners.get(q)?.delete(cb); },
    };
  };
  set(q: string, v: boolean): void { this.matches[q] = v; this.listeners.get(q)?.forEach((cb) => cb()); }
}

export class FakeClipboard {
  text = '';
  fail = false;
  async writeText(s: string): Promise<void> { if (this.fail) throw new Error('denied'); this.text = s; }
}
