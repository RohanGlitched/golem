import { describe, expect, it } from 'vitest';
import { buildMonitor } from '../monitor.js';
import type { MonitorSpec, PredicateTemplate, Trace } from '../types.js';

const above = (signal: string, unit = 'm'): PredicateTemplate => ({
  phrase: `keep ${signal} above {length}`,
  signals: [signal],
  unit,
  margin: (s, k) => s[signal]! - k.threshold!,
});

function trace(t: number[], sig: Record<string, number[]>, events: Trace['events'] = []): Trace {
  const signals: Record<string, Float64Array> = {};
  for (const k of Object.keys(sig)) signals[k] = Float64Array.from(sig[k]!);
  return { t: Float64Array.from(t), signals, events };
}

const spec = (over: Partial<MonitorSpec>): MonitorSpec => ({
  pattern: 'event',
  predicate: above('z'),
  slots: { threshold: 0 },
  wrapper: { kind: 'always', duration: 3 },
  ...over,
});

const ts = [0, 1, 2, 3, 4, 5];
const trig = [{ name: 'trigger', t: 1 }];

describe('buildMonitor', () => {
  it('takes the minimum over [t0, t0+3 s] with both end samples included', () => {
    // window [1,4]; sample at t=0 (value -9) and t=5 (value -8) are outside
    const tr = trace(ts, { z: [-9, 5, 3, 4, 2, -8] }, trig);
    const r = buildMonitor(spec({}))(tr);
    expect(r).toEqual({ robustness: 2, worstAt: 4, unit: 'm' });
  });

  it('for within, takes the minimum from the deadline to the end and reports the last violation', () => {
    // F[1,3] G[., 5]: reached at t=3 and held; the last violation was at t=2.
    const tr = trace(ts, { z: [9, -1, -2, 0.5, 7, 8] }, trig);
    const r = buildMonitor(spec({ wrapper: { kind: 'eventually', duration: 2 } }))(tr);
    expect(r).toEqual({ robustness: 0.5, worstAt: 2, unit: 'm' });
  });

  it('for within, fails a predicate that holds at the deadline and breaks afterwards', () => {
    const tr = trace(ts, { z: [9, 5, 5, 5, -1, 8] }, trig);
    const r = buildMonitor(spec({ wrapper: { kind: 'eventually', duration: 2 } }))(tr);
    expect(r).toEqual({ robustness: -1, worstAt: 4, unit: 'm' });
  });

  it('evaluates only samples up to the last one when the window extends past it', () => {
    const tr = trace(ts, { z: [1, 1, 4, 3, 2, 6] }, [{ name: 'trigger', t: 3 }]);
    const r = buildMonitor(spec({ wrapper: { kind: 'always', duration: 100 } }))(tr);
    expect(r).toEqual({ robustness: 2, worstAt: 4, unit: 'm' });
  });

  it('returns NaN with unit trace when the window holds no sample', () => {
    const tr = trace(ts, { z: [1, 1, 1, 1, 1, 1] }, [{ name: 'trigger', t: 9 }]);
    expect(buildMonitor(spec({}))(tr)).toEqual({ robustness: NaN, worstAt: 0, unit: 'trace' });
  });

  it('keeps the earliest time when several samples tie', () => {
    const tr = trace(ts, { z: [0, 2, 1, 1, 5, 5] }, trig);
    expect(buildMonitor(spec({}))(tr).worstAt).toBe(2);
    // within 4 s: the hold window is the single sample at t=5; nothing was violated.
    const ev = buildMonitor(spec({ wrapper: { kind: 'eventually', duration: 4 } }))(tr);
    expect(ev).toEqual({ robustness: 5, worstAt: 5, unit: 'm' });
  });

  it('returns NaN with unit trace when there is no trigger event', () => {
    const tr = trace(ts, { z: [1, 1, 1, 1, 1, 1] });
    expect(buildMonitor(spec({}))(tr)).toEqual({ robustness: NaN, worstAt: 0, unit: 'trace' });
  });

  it('returns NaN with unit signal when a signal is missing', () => {
    const tr = trace(ts, { y: [1, 1, 1, 1, 1, 1] }, trig);
    expect(buildMonitor(spec({}))(tr)).toEqual({ robustness: NaN, worstAt: 0, unit: 'signal' });
  });

  it('returns NaN at the first NaN margin with the predicate unit', () => {
    const tr = trace(ts, { z: [1, 1, NaN, NaN, 1, 1] }, trig);
    expect(buildMonitor(spec({}))(tr)).toEqual({ robustness: NaN, worstAt: 2, unit: 'm' });
  });

  it('returns +Infinity for a disabled feature, even without a trigger', () => {
    const r = buildMonitor(spec({ pattern: 'optional', disabledFeature: true }))(trace([], { z: [] }));
    expect(r).toEqual({ robustness: Infinity, worstAt: 0, unit: 'm' });
  });

  it('uses the whole trace for a ubiquitous requirement and does not write to the trace', () => {
    const tr = trace(ts, { z: [4, 3, 2, 1, 0.5, 6] });
    const before = JSON.stringify([...tr.t, ...tr.signals.z!]);
    const r = buildMonitor(spec({ pattern: 'ubiquitous', wrapper: { kind: 'always' } }))(tr);
    expect(r).toEqual({ robustness: 0.5, worstAt: 4, unit: 'm' });
    expect(JSON.stringify([...tr.t, ...tr.signals.z!])).toBe(before);
  });

  it('state pattern takes min of max(-stateMargin, responseMargin)', () => {
    // state: s > 0 holds. response: z > 0.
    const stateP = above('s', 'N');
    const tr = trace([0, 1, 2], { z: [-5, 2, 1], s: [-3, 1, 1] });
    const m = buildMonitor(
      spec({
        pattern: 'state',
        wrapper: { kind: 'always' },
        stateMargin: { predicate: stateP, slots: { threshold: 0 } },
      }),
    );
    // t=0: state fails, max(3,-5)=3; t=1: max(-1,2)=2; t=2: max(-1,1)=1
    expect(m(tr)).toEqual({ robustness: 1, worstAt: 2, unit: 'm' });
    // a violation while the state holds is negative: max(-1, -2) = -1
    const bad = trace([0, 1], { z: [-2, 2], s: [1, 1] });
    expect(m(bad)).toEqual({ robustness: -1, worstAt: 0, unit: 'm' });
  });
});
