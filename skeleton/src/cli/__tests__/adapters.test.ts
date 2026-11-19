import { describe, expect, it } from 'vitest';
import { createTraceRunner, copyTrace, type SimLike } from '../adapters/trace.js';
import { TraceUnavailableError } from '../deps.js';
import { bindingsOf, marginsOf, MARGINS_UNAVAILABLE } from '../../mcp/predicates.js';
import { createUnitCapture, reportVerdict, signalUnit, UNIT_MISSING } from '../signal-units.js';
import { explain, MarginsUnavailableError } from '../../mcp/margins.js';
import { tinyApp, tinyLexicon, tinyTrace, tinyTrial } from '../../../test/support/tiny-app.js';
import { tinyReq } from '../../../test/support/outcomes.js';

const spec = { app: 'tiny', reqId: '1.2', scenario: { 'push.force': 120 }, seed: 3 };
const req = tinyReq('1.2');

class Cache { disposed = false; dispose() { this.disposed = true; } }

describe('trace adapter', () => {
  it('uses TrialResult.trace when the sim returns it', async () => {
    const t = tinyTrace(spec);
    const sim: SimLike = { ModelCache: Cache, runTrial: async (_a, _r, s) => ({ ...tinyTrial(req, s).result, trace: t }) };
    const r = await createTraceRunner(async () => sim).runTraced(tinyApp, req, spec);
    expect(r.trace).toBe(t);
  });

  it('captures the trace through the earlyStop hook of a sim without the optional exposure', async () => {
    const full = tinyTrace(spec);
    const sim: SimLike = {
      ModelCache: Cache,
      async runTrial(_a, _r, s, o) {
        for (let k = 1; k <= full.t.length; k++) o.earlyStop?.(full, k);
        return tinyTrial(req, s).result;
      },
    };
    const r = await createTraceRunner(async () => sim).runTraced(tinyApp, req, spec);
    expect(r.trace.t).toEqual(full.t);
    expect(r.trace.t).not.toBe(full.t);
    expect(r.trace.signals['height']).toEqual(full.signals['height']);
    expect('trace' in r.result).toBe(false);
  });

  it('copies only the valid samples when a trial stops early', () => {
    const full = tinyTrace(spec);
    expect(copyTrace(full, 5).t).toHaveLength(5);
    expect(copyTrace(full, 5).signals['tilt']).toHaveLength(5);
  });

  it('throws TraceUnavailableError naming golem-sim when the sim offers neither', async () => {
    const sim: SimLike = { ModelCache: Cache, runTrial: async (_a, _r, s) => tinyTrial(req, s).result };
    const p = createTraceRunner(async () => sim).runTraced(tinyApp, req, spec);
    await expect(p).rejects.toBeInstanceOf(TraceUnavailableError);
    await expect(p).rejects.toThrow('golem-sim');
  });

  it('reuses one model cache per app and disposes it', async () => {
    const caches: Cache[] = [];
    const sim: SimLike = {
      ModelCache: class extends Cache { constructor() { super(); caches.push(this); } },
      runTrial: async (_a, _r, s, o) => { o.earlyStop?.(tinyTrace(s), 3); return tinyTrial(req, s).result; },
    };
    const runner = createTraceRunner(async () => sim);
    await runner.runTraced(tinyApp, req, spec);
    await runner.runTraced(tinyApp, req, spec);
    expect(caches).toHaveLength(1);
    await runner.dispose();
    expect(caches[0]?.disposed).toBe(true);
  });
});

describe('predicate and margins fallbacks', () => {
  const trace = tinyTrace(spec);
  const mon = req.monitor(trace);

  it('reads margins and bindings only when present and non-empty', () => {
    expect(marginsOf({})).toBeUndefined();
    expect(marginsOf({ margins: {} })).toBeUndefined();
    expect(marginsOf({ margins: { a: 1 } })).toEqual({ a: 1 });
    expect(bindingsOf({})).toBeUndefined();
    expect(bindingsOf({ predicates: [] })).toBeUndefined();
  });

  it('prefers the margins map, then the bindings, then names the missing bindings', () => {
    const bindings = [{ predicate: tinyLexicon.predicates[0] as never, slots: { length: 0.4 } }];
    expect(explain({ predicates: bindings }, trace, { ...mon, margins: { height: 1 } }).source).toBe('monitor');
    expect(explain({ predicates: bindings }, trace, mon).source).toBe('recomputed');
    expect(explain({}, trace, { ...mon, margins: { height: 1 } }).source).toBe('monitor');
    expect(() => explain({}, trace, mon)).toThrow(MarginsUnavailableError);
    expect(new MarginsUnavailableError().message).toBe(MARGINS_UNAVAILABLE);
  });
});

describe('signal units', () => {
  it('prefers the declared unit, then a predicate that reads the signal, then the missing text', () => {
    expect(signalUnit(tinyApp, 'height')).toBe('m');
    expect(signalUnit({ lexicon: tinyLexicon }, 'tilt')).toBe('rad');
    expect(signalUnit({ lexicon: tinyLexicon, signalUnits: { tilt: 'deg' } }, 'tilt')).toBe('deg');
    expect(signalUnit({ lexicon: tinyLexicon }, 'nope')).toBe(UNIT_MISSING);
    expect(UNIT_MISSING).toBe('unit not declared');
  });

  it('captures the unit through onResult and stores it on a report entry', () => {
    const cap = createUnitCapture();
    cap.onResult({ unit: 'm', spec: { reqId: '1.2' } });
    expect(cap.unitOf('1.2')).toBe('m');
    expect(cap.unitOf('x')).toBeUndefined();
    const v = { reqId: '1.2', status: 'held' as const, trials: 1, randomTrials: 1, guidedTrials: 0, closest: { robustness: 1, scenario: {}, seed: 1 }, ms: 1 };
    expect(reportVerdict(v, cap.unitOf('1.2'), 'EARS')).toMatchObject({ unit: 'm', ears: 'EARS' });
    expect('unit' in reportVerdict(v, undefined)).toBe(false);
  });
});
