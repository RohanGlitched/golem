import { describe, expect, it, vi } from 'vitest';
import { RecordingPool } from '../run/recording-pool.js';
import { callFalsify, defaultFalsify, golemFalsify, isAbort } from '../run/falsify-adapter.js';
import { seedToJson } from '../run/seed-json.js';
import { pinKey } from '../run/pins.js';
import { FakePool, fakeFalsify, synthResult } from './fakes.js';
import { lineOf, runRig } from './generators/run.js';
import { swarmRig } from './generators/swarm.js';
import type { Counterexample, FalsifyFn, TrialSpec } from '../types.js';

const specs = (n: number): TrialSpec[] => Array.from({ length: n }, (_, i) => ({ app: 'test', reqId: '1.1', scenario: { 'push.force': i }, seed: i }));
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('RecordingPool', () => {
  it('forwards a run in one call with poses on, ingests each result once and strips poses from what it returns', async () => {
    const inner = new FakePool((s) => synthResult(s));
    const ingested: number[] = [];
    const rp = new RecordingPool(inner, { ingest: (r) => { expect(r.poses).toBeDefined(); ingested.push(r.spec.seed); } }, 'test');
    const out = await rp.run(specs(130).map((s) => ({ ...s, app: '' })));
    expect(inner.calls.map((c) => c.length)).toEqual([130]);
    expect(inner.calls.flat().every((s) => s.record === 'poses' && s.app === 'test')).toBe(true);
    expect(out).toHaveLength(130);
    expect(out.every((r) => !('poses' in r))).toBe(true);
    expect(ingested).toEqual(specs(130).map((s) => s.seed));
    expect(rp.size).toBe(inner.size);
    await rp.close();
    expect(inner.closed).toBe(false);
  });
  it('propagates a throwing run', async () => {
    const inner = new FakePool(() => { throw new Error('worker crashed'); });
    const rp = new RecordingPool(inner, { ingest: () => {} });
    await expect(rp.run(specs(3))).rejects.toThrow('worker crashed');
    expect(rp.lastChunk).toHaveLength(3);
  });
});

describe('falsify adapter', () => {
  it('passes seeds, signal, generation size and app id through to the falsifier', async () => {
    let seen: Parameters<FalsifyFn>[4] | undefined;
    const fake: FalsifyFn = async (req, _p, _b, _s, o) => {
      seen = o;
      return { reqId: req.id, status: 'held', trials: 0, randomTrials: 0, guidedTrials: 0, closest: { robustness: 1, scenario: {}, seed: 0 }, ms: 0 };
    };
    const ac = new AbortController();
    const seeds: Counterexample[] = [{ reqId: '1.1', scenario: { 'push.force': 3 }, seed: 9, robustness: -1, shrunk: true, foundAfter: 2 }];
    await callFalsify(fake, lineOf('1.1').compiled!, new FakePool((s) => synthResult(s)), {}, 1, { signal: ac.signal, seeds, generationSize: 32, appId: 'test' });
    expect(seen?.signal).toBe(ac.signal);
    expect(seen?.seeds).toEqual(seeds);
    expect(seen?.generationSize).toBe(32);
    expect(seen?.appId).toBe('test');
  });
  it('golem-falsify runs the pinned seed first, then random generations, then shrinks and classifies', async () => {
    const pool = new FakePool((s) => synthResult(s));
    const seeds: Counterexample[] = [{ reqId: '1.1', scenario: { 'push.force': 5, 'push.angle': 0 }, seed: 9, robustness: 95, shrunk: false, foundAfter: 0 }];
    const events: { phase: number; generation: number; trials: number }[] = [];
    const v = await golemFalsify(lineOf('1.1').compiled!, pool, { maxTrials: 100 }, 1, {
      seeds, generationSize: 10, appId: 'test', onProgress: (e) => events.push(e),
    });
    expect(pool.calls[0]).toEqual([{ app: 'test', reqId: '1.1', scenario: seeds[0]!.scenario, seed: 9 }]);
    expect(pool.calls[1]!).toHaveLength(10); // Phase 1 generation of the requested size
    expect(v.status).toBe('broken');
    expect(v.counterexample!.robustness).toBeLessThan(0);
    expect(v.counterexample!.shrunk).toBe(true);
    expect(['robust', 'seed-sensitive']).toContain(v.counterexample!.classification);
    // The shrunk scenario is as mild as the 100 N edge of the synthetic requirement allows.
    expect(v.counterexample!.scenario['push.force']).toBeLessThan(110);
    expect(events[0]).toEqual({ phase: 0, generation: 0, trials: 1 });
    expect(events.map((e) => e.phase)).toEqual([...events.map((e) => e.phase)].sort());
    expect(events.at(-1)!.phase).toBe(3);
    expect(events.at(-1)!.trials).toBe(v.trials);
  });
  it('golem-falsify reports held with the rule-of-three bound when nothing breaks, within the budget', async () => {
    const pool = new FakePool((s) => synthResult(s));
    const v = await golemFalsify(lineOf('1.1', 50).compiled!, pool, { maxTrials: 30 }, 1, { generationSize: 10 });
    expect(v.status).toBe('held');
    expect(v.trials).toBe(30);
    expect(v.counterexample).toBeUndefined();
    // The bound comes from the Phase 1 random trials only: 0 failures in n gives 3 / n.
    expect(v.randomTrials).toBeGreaterThan(0);
    expect(v.failureRateUpper95).toBeCloseTo(3 / v.randomTrials, 12);
  });
  it('golem-falsify throws the recorded reason when no trial can complete', async () => {
    const pool = new FakePool(() => { throw new Error('Worker 2 crashed'); });
    await expect(golemFalsify(lineOf('1.1').compiled!, pool, { maxTrials: 30 }, 1, { generationSize: 10 })).rejects.toThrow('Worker 2 crashed');
  });
  it('golem-falsify rejects with an AbortError when the signal aborts', async () => {
    const ac = new AbortController();
    ac.abort();
    const pool = new FakePool((s) => synthResult(s));
    await expect(golemFalsify(lineOf('1.1').compiled!, pool, { maxTrials: 30 }, 1, { signal: ac.signal })).rejects.toSatisfy(isAbort);
    expect(pool.calls).toHaveLength(0);
  });
  it('the studio falsifier defaults to golem-falsify', () => {
    expect(defaultFalsify).toBe(golemFalsify);
  });
});
describe('RunController', () => {
  it('shows the running status within 100 ms of a summon', async () => {
    const { rc, line, clock } = runRig();
    const p = rc.start('1.1');
    for (let i = 0; i < 3; i++) await Promise.resolve();
    expect(line('1.1').status).toBe('running');
    await p;
  });
  it('stores the verdict and the summary, and announces it', async () => {
    const { rc, line, polite } = runRig();
    await rc.start('1.1');
    const l = line('1.1');
    expect(l.status).toBe('broken');
    expect(l.verdict?.status).toBe('broken');
    expect(l.summary).toMatch(/^fails from \d+ N at \d+ deg$/);
    expect(polite.textContent).toMatch(/^Requirement 1\.1 broken: fails from/);
  });
  it('maps each falsifier progress event to one swarm generation and records poses for every trial', async () => {
    const { swarm } = swarmRig();
    const begin = vi.spyOn(swarm, 'beginGeneration');
    const commit = vi.spyOn(swarm, 'commitGeneration');
    const events: { phase: number; generation: number; trials: number }[] = [];
    const pool = new FakePool((s) => synthResult(s));
    const falsify: FalsifyFn = (req, p, b, s, o) => golemFalsify(req, p, b, s, { ...o, onProgress: (e) => { events.push(e); o.onProgress?.(e); } });
    const r = runRig({ pool, falsify, deps: { swarm: () => swarm, generationSize: 16 } });
    await r.rc.start('1.1');
    const v = r.line('1.1').verdict!;
    // Phase 0 had no pinned seed, so its event carries no trials and opens no generation.
    const withTrials = events.filter((e) => e.phase !== 0);
    expect(v.status).toBe('broken');
    expect(withTrials.length).toBeGreaterThan(1);
    expect(begin).toHaveBeenCalledTimes(withTrials.length);
    expect(commit).toHaveBeenCalledTimes(withTrials.length);
    expect(pool.calls.flat().every((s) => s.record === 'poses')).toBe(true);
    expect(r.line('1.1').progress?.trials).toBe(v.trials);
    expect(r.store.getState().run).toBeUndefined();
    // The Phase 3 generation holds the shrink trials, one run call each, in a single swarm generation.
    expect(pool.calls.filter((c) => c.length === 1).length).toBeGreaterThan(1);
  });
  it('closes the open generation when the verdict arrives without a final progress event', async () => {
    const { swarm } = swarmRig();
    const begin = vi.spyOn(swarm, 'beginGeneration');
    const commit = vi.spyOn(swarm, 'commitGeneration');
    const noEvents: FalsifyFn = async (req, pool) => {
      await pool.run(Array.from({ length: 3 }, (_, i) => ({ app: 'test', reqId: req.id, scenario: { 'push.force': i }, seed: i })));
      await pool.run([{ app: 'test', reqId: req.id, scenario: { 'push.force': 9 }, seed: 9 }]);
      return { reqId: req.id, status: 'held', trials: 4, randomTrials: 4, guidedTrials: 0, closest: { robustness: 1, scenario: {}, seed: 0 }, ms: 1 };
    };
    const r = runRig({ falsify: noEvents, deps: { swarm: () => swarm } });
    await r.rc.start('1.1');
    expect(begin).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });  it('marks the previous verdict stale when a run is cancelled', async () => {
    const slow: FalsifyFn = (req, pool, b, s, o) => new Promise((res, rej) => {
      o.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      void fakeFalsify(5, 5)(req, pool, b, s, {}).then(() => {});
    });
    const { rc, line, alert } = runRig();
    await rc.start('1.1');
    const verdict = line('1.1').verdict;
    (rc as unknown as { d: { falsify: FalsifyFn } }).d.falsify = slow;
    const p = rc.start('1.1');
    await tick();
    expect(line('1.1').status).toBe('running');
    await rc.stop();
    await p;
    expect(line('1.1').stale).toBe(true);
    expect(line('1.1').verdict).toBe(verdict);
    expect(line('1.1').status).toBe('broken');
    expect(alert.textContent).toBe('');
  });
  it('passes pinned seeds as Phase 0 seeds', async () => {
    let seeds: Counterexample[] | undefined;
    const spy: FalsifyFn = async (req, pool, b, s, o) => { seeds = o.seeds; return fakeFalsify(2, 2)(req, pool, b, s, o); };
    const ce: Counterexample = { reqId: '1.1', scenario: { 'push.force': 150 }, seed: 4, robustness: -2, shrunk: true, foundAfter: 3 };
    const r = runRig({ falsify: spy });
    r.storage.setItem(pinKey('test', '1.1'), `[${seedToJson(ce)}]`);
    await r.rc.start('1.1');
    expect(seeds).toEqual([ce]);
  });
  it('sets error with the trial named for a pool failure, but shows nothing for AbortError', async () => {
    const pool = new FakePool(() => { throw new Error('Worker 2 crashed'); });
    const { rc, line, alert } = runRig({ pool });
    await rc.start('1.1');
    expect(line('1.1').status).toBe('error');
    expect(line('1.1').error).toMatch(/^Worker 2 crashed \(trial: app test, requirement 1\.1, scenario \{ push\.angle = .*, push\.force = .* \}, seed \d+\)$/);
    expect(alert.textContent).toMatch(/Requirement 1\.1 could not be tested: Worker 2 crashed/);
    expect(line('1.2').status).toBe('untested');
    const abortPool = new FakePool(() => { throw Object.assign(new Error('x'), { name: 'AbortError' }); });
    const r2 = runRig({ pool: abortPool });
    await r2.rc.start('1.1');
    expect(r2.line('1.1').status).toBe('untested');
    expect(r2.alert.textContent).toBe('');
  });
  it('starts no run for a line with an error diagnostic', async () => {
    const bad = { ...lineOf('1.1'), diagnostics: [{ kind: 'MISSING_UNIT' as const, severity: 'error' as const, message: 'x', line: 1, column: 1, start: 0, end: 1 }] };
    const pool = new FakePool((s) => synthResult(s));
    const { rc, line } = runRig({ lines: [bad], pool });
    await rc.start('1.1');
    expect(pool.calls).toHaveLength(0);
    expect(line('1.1').status).toBe('error');
  });
  it('runs every line in file order', async () => {
    const order: string[] = [];
    const spy: FalsifyFn = async (req, pool, b, s, o) => { order.push(req.id); return fakeFalsify(2, 2)(req, pool, b, s, o); };
    const { rc, line } = runRig({ falsify: spy, lines: [lineOf('2.1'), lineOf('1.3'), lineOf('3.1')] });
    await rc.startAll();
    expect(order).toEqual(['2.1', '1.3', '3.1']);
    expect(line('3.1').verdict).toBeDefined();
  });
});
