// Run_Controller: one falsifier run at a time on the shared pool. Every callback carries its Run_Id,
// so a stale run can never change current state.
import { AuraModel, auraDims } from '../aura/aura-model.js';
import { auraSummary } from '../aura/aura-summary.js';
import type { Announcer } from '../core/announcer.js';
import type { StudioStore } from '../core/store.js';
import type { GhostMeta, GhostSwarm } from '../ghosts/ghost-swarm.js';
import type { ResolvedArrow } from '../ghosts/push-arrow.js';
import { callFalsify, isAbort } from './falsify-adapter.js';
import { canRegister } from './inline-pool.js';
import type { PinnedSeedStore } from './pins.js';
import { RecordingPool } from './recording-pool.js';
import { counterexampleSummary, statusOfVerdict, statusText } from './status.js';
import type {
  Budget, ClassifiedCounterexample, CompiledRequirement, FalsifyFn, Kind, LineModel, Retained, Scenario, TrialPool,
  TrialResult, TrialSpec, Verdict,
} from '../types.js';

export interface RunDeps {
  appId: string;
  warmup: number;
  store: StudioStore;
  pool: TrialPool | undefined;
  falsify: FalsifyFn;
  pins: PinnedSeedStore;
  announcer: Announcer;
  /** Milliseconds. */
  now(): number;
  budget: Budget;
  seed: number;
  generationSize: number;
  swarm(): GhostSwarm | undefined;
  /** Rewrites the Aura texture (one render request). */
  auraChanged(m: AuraModel | undefined): void;
  arrowOf?(req: CompiledRequirement, scenario: Scenario): ResolvedArrow | undefined;
  isFall?(req: CompiledRequirement): boolean;
  summaryPhrases?: Partial<Record<Kind, string>>;
  /** Called when a run starts (summon counts as activity for the hero). */
  onActivity?(): void;
}

interface Active {
  runId: number;
  lineId: string;
  ac: AbortController;
  trials: number;
  generation: number;
  closest?: Retained;
  bestCe?: Retained;
  genResults: TrialResult[];
  /** True while results of a Generation have arrived and its progress event has not. */
  open: boolean;
  unit: string;
  settled: Promise<void>;
  rec?: RecordingPool;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function specText(s: TrialSpec | undefined): string {
  if (!s) return '';
  const sc = Object.keys(s.scenario).sort().map((k) => `${k} = ${s.scenario[k]}`).join(', ');
  return ` (trial: app ${s.app}, requirement ${s.reqId}, scenario { ${sc} }, seed ${s.seed})`;
}

const sameTrial = (a: { scenario: Scenario; seed: number }, b: { scenario: Scenario; seed: number }): boolean => {
  if (a.seed !== b.seed) return false;
  const ka = Object.keys(a.scenario), kb = Object.keys(b.scenario);
  return ka.length === kb.length && ka.every((k) => a.scenario[k] === b.scenario[k]);
};

export class RunController {
  private lastRunId = 0;
  private active: Active | undefined;
  private queue: string[] = [];
  private queueToken = 0;
  /** Aura per line, so selecting a line shows its own boundary. */
  readonly auras = new Map<string, AuraModel>();
  /** Retained poses of a line's best counterexample, for the Reel (no replay trial needed). */
  readonly reelCache = new Map<string, Retained>();
  /** Number of falsifier calls in flight (at most one). */
  inFlight = 0;
  disposed = false;

  constructor(private readonly d: RunDeps) {}

  get activeRunId(): number | undefined { return this.active?.runId; }
  get activeLineId(): string | undefined { return this.active?.lineId; }

  private line(id: string): LineModel | undefined { return this.d.store.getState().lines.find((l) => l.id === id); }

  private guard(runId: number, fn: () => void): void { if (this.active?.runId === runId) fn(); }

  /** The Aura shows the selected line's data (or a no-data state). */
  select(lineId: string | undefined): void {
    this.d.store.update({ selectedId: lineId });
    this.refreshAura();
  }

  private refreshAura(): void {
    const s = this.d.store.getState();
    const id = this.active?.lineId ?? s.selectedId;
    const line = id ? this.line(id) : undefined;
    const m = id ? this.auras.get(id) : undefined;
    const hasDims = !!(line?.compiled && auraDims(line.compiled.space));
    const summary = !line?.compiled ? 'No trials yet' : hasDims ? auraSummary(m ?? new AuraModel(1)) : auraSummary(undefined);
    this.d.store.update({ aura: { total: m?.total ?? 0, ignored: m?.ignored ?? 0, summary } });
    this.d.auraChanged(hasDims ? m : undefined);
  }

  /** Aborts the active run and waits for it to settle. */
  private async cancelActive(): Promise<void> {
    const a = this.active;
    if (!a) return;
    a.ac.abort();
    await a.settled;
  }

  async start(lineId: string): Promise<void> {
    if (this.disposed) return;
    const runId = ++this.lastRunId;
    await this.cancelActive();
    if (runId !== this.lastRunId || this.disposed) return; // superseded by a newer click
    const line = this.line(lineId);
    if (!line) return;
    if (line.diagnostics.some((x) => x.severity === 'error') || !line.compiled) {
      this.d.store.setLine(lineId, { status: 'error' });
      return;
    }
    const pool = this.d.pool;
    if (!pool) return;
    const req = line.compiled;
    if (canRegister(pool)) pool.register(req);
    let settle!: () => void;
    const a: Active = {
      runId, lineId, ac: new AbortController(), trials: 0, generation: 0, genResults: [], open: false, unit: line.unit ?? '',
      settled: new Promise<void>((r) => { settle = r; }),
    };
    this.active = a;
    this.d.onActivity?.();
    const dims = auraDims(req.space);
    const aura = dims ? new AuraModel(Math.max(dims.force.max, 0)) : undefined;
    if (aura) this.auras.set(lineId, aura); else this.auras.delete(lineId);
    this.d.swarm()?.clear();
    this.d.store.update((s) => ({
      selectedId: lineId,
      run: { runId, lineId, trials: 0, generation: 0 },
      lines: s.lines.map((l) => (l.id === lineId ? { ...l, status: 'running', progress: { trials: 0 }, stale: !!l.verdict, fracture: undefined } : l)),
    }));
    this.refreshAura();
    const rec = new RecordingPool(pool, { ingest: (r) => this.guard(runId, () => this.ingest(a, req, r, aura)) }, this.d.appId);
    a.rec = rec;
    this.inFlight++;
    try {
      const verdict = await callFalsify(this.d.falsify, req, rec, this.d.budget, this.d.seed, {
        signal: a.ac.signal,
        seeds: this.d.pins.read(this.d.appId, req.id),
        generationSize: this.d.generationSize,
        appId: this.d.appId,
        // The falsifier reports one event per generation of trials: the swarm's Generation ends there.
        onProgress: (e) => this.guard(runId, () => {
          this.commitGeneration(a);
          this.d.store.update((s) => (s.run ? { run: { ...s.run, phase: e.phase } } : {}));
          this.d.announcer.announceProgress(`Running ${lineId}: ${a.trials} trials`, this.d.now());
        }),
      });
      this.guard(runId, () => this.finish(a, req, verdict));
    } catch (err) {
      if (isAbort(err) || a.ac.signal.aborted) this.guard(runId, () => this.cancelled(a));
      else this.guard(runId, () => this.fail(a, err, rec.lastChunk[0]));
    } finally {
      this.inFlight--;
      if (this.active === a) this.active = undefined;
      settle();
    }
  }

  private beginGeneration(a: Active): void {
    // Drop the previous generation's poses except the retained closest call and best counterexample.
    a.genResults = [];
    a.generation++;
    a.open = true;
    this.d.swarm()?.beginGeneration();
  }

  /** The falsifier's progress event: the trials received since the last one are one Generation. */
  private commitGeneration(a: Active): void {
    if (!a.open) return;
    a.open = false;
    this.d.swarm()?.commitGeneration(this.d.now() / 1000);
  }

  private ingest(a: Active, req: CompiledRequirement, r: TrialResult, aura: AuraModel | undefined): void {
    if (!a.open) this.beginGeneration(a);
    a.trials++;
    if (!a.unit && r.unit) a.unit = r.unit;
    const dims = auraDims(req.space);
    if (aura && dims) {
      aura.add(r.spec.scenario[dims.angle.name] ?? Number.NaN, r.spec.scenario[dims.force.name] ?? Number.NaN, r.robustness);
    }
    const keep = (): Retained => ({ spec: r.spec, robustness: r.robustness, worstAt: r.worstAt, ...(r.poses ? { poses: r.poses } : {}) });
    if (!a.closest || r.robustness < a.closest.robustness) a.closest = keep();
    if (r.robustness < 0 && (!a.bestCe || r.robustness < a.bestCe.robustness)) a.bestCe = keep();
    if (r.poses) {
      a.genResults.push(r);
      const meta: GhostMeta = { robustness: r.robustness, worstAt: r.worstAt, warmup: this.d.warmup, arrow: this.d.arrowOf?.(req, r.spec.scenario) };
      this.d.swarm()?.accept(r, meta, this.d.now() / 1000);
    }
    this.d.store.update((s) => ({
      run: s.run ? { ...s.run, trials: a.trials, generation: a.generation } : s.run,
      lines: s.lines.map((l) => (l.id === a.lineId ? { ...l, progress: { trials: a.trials } } : l)),
      aura: aura ? { ...s.aura, total: aura.total, ignored: aura.ignored, summary: auraSummary(aura) } : s.aura,
    }));
    this.d.auraChanged(aura);
  }

  /** Number of results the controller holds pose arrays for (bounded, Property 19). */
  heldPoseCount(): number {
    const a = this.active;
    if (!a) return 0;
    const set = new Set<unknown>();
    for (const r of a.genResults) if (r.poses) set.add(r.poses);
    if (a.closest?.poses) set.add(a.closest.poses);
    if (a.bestCe?.poses) set.add(a.bestCe.poses);
    return set.size;
  }

  get closestCall(): Retained | undefined { return this.active?.closest; }

  private finish(a: Active, req: CompiledRequirement, v: Verdict & { counterexample?: ClassifiedCounterexample }): void {
    this.commitGeneration(a); // trials that arrived after the last progress event
    const status = statusOfVerdict(v);
    const fall = this.d.isFall?.(req) ?? false;
    const ce = v.counterexample;
    let summary: string;
    if (status === 'broken' && ce) summary = counterexampleSummary(req.space, ce.scenario, ce.classification, this.d.summaryPhrases, fall);
    else summary = statusText({ status, verdict: v, unit: a.unit });
    if (ce && a.bestCe && sameTrial(a.bestCe.spec, ce) && a.bestCe.poses) this.reelCache.set(a.lineId, a.bestCe);
    else this.reelCache.delete(a.lineId);
    a.genResults = [];
    const patch: Partial<LineModel> = {
      status, verdict: v, stale: false, summary, unit: a.unit, progress: { trials: v.trials },
    };
    if (ce) patch.counterexample = ce; else patch.counterexample = undefined;
    this.d.store.update((s) => ({
      run: undefined,
      lines: s.lines.map((l) => (l.id === a.lineId ? { ...l, ...patch } : l)),
    }));
    this.refreshAura();
    const word = status === 'broken' ? 'broken' : status === 'held' ? 'held' : 'error';
    const text = status === 'broken' ? summary : status === 'held' ? `no counterexample found in ${v.trials} trials` : summary;
    this.d.announcer.announceFinal(`Requirement ${a.lineId} ${word}: ${text}`);
  }

  private cancelled(a: Active): void {
    this.d.swarm()?.clear();
    this.d.store.update((s) => ({
      run: undefined,
      lines: s.lines.map((l) => (l.id === a.lineId
        ? { ...l, status: l.verdict ? statusOfVerdict(l.verdict) : 'untested', stale: !!l.verdict, progress: undefined }
        : l)),
    }));
  }

  private fail(a: Active, err: unknown, spec: TrialSpec | undefined): void {
    const msg = `${errText(err)}${specText(spec)}`;
    this.d.store.update((s) => ({
      run: undefined,
      lines: s.lines.map((l) => (l.id === a.lineId ? { ...l, status: 'error', error: msg, summary: `Error: ${msg}`, stale: false } : l)),
    }));
    this.d.announcer.announceError(`Requirement ${a.lineId} could not be tested: ${msg}`);
  }

  /** Runs every compilable line in file order, one after another. */
  async startAll(): Promise<void> {
    const token = ++this.queueToken;
    this.queue = this.d.store.getState().lines
      .filter((l) => l.compiled && !l.diagnostics.some((x) => x.severity === 'error')).map((l) => l.id);
    while (this.queue.length > 0 && token === this.queueToken && !this.disposed) {
      const id = this.queue.shift() as string;
      await this.start(id);
    }
  }

  get runningAll(): boolean { return this.queue.length > 0; }

  /** "Stop the run": aborts the active run and clears the run-all queue. */
  async stop(): Promise<void> {
    this.queueToken++;
    this.queue = [];
    this.lastRunId++;
    await this.cancelActive();
  }

  /** Aborts without waiting (used by dispose). */
  abortNow(): void {
    this.disposed = true;
    this.queueToken++;
    this.queue = [];
    this.active?.ac.abort();
  }

  async dispose(): Promise<void> {
    this.abortNow();
    const a = this.active;
    if (a) await a.settled;
  }
}
