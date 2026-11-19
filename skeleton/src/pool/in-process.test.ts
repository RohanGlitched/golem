import { describe, expect, it } from 'vitest';
import type { TrialResult, TrialSpec } from '../falsify/contract.js';
import { AbortError, PoolClosedError, TrialError } from '../falsify/errors.js';
import { InProcessPool } from './in-process.js';
import { pureTrial, spec } from './scheduler.testkit.js';

describe('InProcessPool', () => {
  it('reports size 1', () => {
    expect(new InProcessPool(pureTrial).size).toBe(1);
  });

  it('returns exactly what the injected function returns, in input order', async () => {
    const order: number[] = [];
    const pool = new InProcessPool((s) => { order.push(s.seed); return pureTrial(s); });
    const specs = [spec(3), spec(1), spec(2)];
    const got = await pool.run(specs);
    expect(order).toEqual([3, 1, 2]);
    expect(got).toEqual(specs.map((s) => pureTrial(s) as TrialResult));
    got.forEach((r, i) => expect(r.spec).toBe(specs[i]));
  });

  it('starts the next trial only after the previous one returned', async () => {
    let running = 0;
    let maxRunning = 0;
    const pool = new InProcessPool(async (s) => {
      running++; maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return pureTrial(s);
    });
    await pool.run([spec(1), spec(2), spec(3)]);
    expect(maxRunning).toBe(1);
  });

  it('runs nothing for an already-aborted signal', async () => {
    let calls = 0;
    const pool = new InProcessPool((s) => { calls++; return pureTrial(s); });
    const ac = new AbortController();
    ac.abort();
    let cb = 0;
    await expect(pool.run([spec(1)], () => { cb++; }, { signal: ac.signal })).rejects.toBeInstanceOf(AbortError);
    expect(calls).toBe(0);
    expect(cb).toBe(0);
  });

  it('sees an abort fired from a timer mid-run and reports only finished trials', async () => {
    const ac = new AbortController();
    let calls = 0;
    const pool = new InProcessPool((s) => {
      calls++;
      if (calls === 3) setTimeout(() => ac.abort(), 0);
      return pureTrial(s);
    });
    const seen: number[] = [];
    const specs = Array.from({ length: 100000 }, (_, i) => spec(i));
    const err = await pool.run(specs, (r) => { seen.push(r.spec.seed); }, { signal: ac.signal }).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(calls).toBeLessThan(100000);
    expect(seen).toEqual(specs.slice(0, seen.length).map((s) => s.seed));
    expect(seen.length).toBeLessThanOrEqual(calls);
  });

  it('does not report the trial in progress when the abort lands during it', async () => {
    const ac = new AbortController();
    const pool = new InProcessPool((s) => { if (s.seed === 1) ac.abort(); return pureTrial(s); });
    const seen: number[] = [];
    await expect(pool.run([spec(0), spec(1), spec(2)], (r) => { seen.push(r.spec.seed); }, { signal: ac.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual([0]);
  });

  it('rejects a throwing trial with a TrialError naming the spec, stops the run and stays usable', async () => {
    const boom = new Error('qacc is NaN');
    const ran: number[] = [];
    const pool = new InProcessPool((s: TrialSpec) => { ran.push(s.seed); if (s.seed === 5) throw boom; return pureTrial(s); });
    const seen: number[] = [];
    const err = (await pool.run([spec(4), spec(5, { x: 1.5 }), spec(6)], (r) => { seen.push(r.spec.seed); }).catch((e: unknown) => e)) as TrialError;
    expect(err).toBeInstanceOf(TrialError);
    expect(err.message).toContain('R1');
    expect(err.message).toContain('seed 5');
    expect(err.message).toContain('app a');
    expect(err.message).toContain('"x":1.5');
    expect(err.cause).toBe(boom);
    expect(ran).toEqual([4, 5]);
    expect(seen).toEqual([4]);
    await expect(pool.run([spec(7)])).resolves.toHaveLength(1);
  });

  it('rejects a run on a closed pool', async () => {
    const pool = new InProcessPool(pureTrial);
    await pool.close();
    await pool.close();
    await expect(pool.run([spec(1)])).rejects.toBeInstanceOf(PoolClosedError);
  });

  it('resolves an empty run with []', async () => {
    let cb = 0;
    await expect(new InProcessPool(pureTrial).run([], () => { cb++; })).resolves.toEqual([]);
    expect(cb).toBe(0);
  });
});
