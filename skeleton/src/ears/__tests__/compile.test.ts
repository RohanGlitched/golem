import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { Dimension, Lexicon, PerturbationTemplate, PredicateTemplate, Trace } from '../types.js';

const push: PerturbationTemplate = {
  phrase: 'the pelvis is pushed with {range:force} for {duration} from {direction}',
  dims: (s) => {
    const f = s['force'] as [{ si: number }, { si: number }];
    const dir = s['direction'] as string;
    const dims: Dimension[] = [
      { name: 'push.force', kind: 'force', min: f[0].si, max: f[1].si, severity: 'up' },
    ];
    if (dir === 'any direction') {
      dims.push({ name: 'push.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true });
    }
    return dims;
  },
  apply: () => {},
};
const dup: PerturbationTemplate = {
  phrase: 'the arm is shaken with {range:force}',
  dims: (s) => {
    const f = s['force'] as [{ si: number }, { si: number }];
    const d: Dimension = { name: 'x.force', kind: 'force', min: f[0].si, max: f[1].si, severity: 'up' };
    return [d, { ...d }];
  },
  apply: () => {},
};
const upright: PredicateTemplate = {
  phrase: 'stay upright', signals: ['h'], unit: 'm', margin: (s) => s['h']! - 0.5,
};
const lit: PredicateTemplate = {
  phrase: 'be on the ground', signals: ['h'], unit: 'm', margin: (s) => 0.3 - s['h']!,
};

const lex = (extra: Partial<Lexicon> = {}): Lexicon => ({
  robotNames: ['robot'], predicates: [upright, lit], perturbations: [push, dup], ...extra,
});

const trace = (h: number): Trace => ({
  t: Float64Array.from([0, 1, 2, 3, 4]),
  signals: { h: Float64Array.from([h, h, h, h, h]) },
  events: [{ name: 'trigger', t: 0 }],
});

describe('compileRequirement', () => {
  it('compiles an event requirement with a searched and a fixed parameter', () => {
    const line = 'R2. WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction THE robot SHALL stay upright for 3 s';
    const r = compileRequirement(line, lex());
    expect(r.diagnostics).toEqual([]);
    const req = r.requirement!;
    expect(req.id).toBe('R2');
    expect(req.source).toBe(line);
    expect(req.pattern).toBe('event');
    expect(req.space.dims.map((d) => d.name)).toEqual(['push.force', 'push.angle']);
    expect(req.perturbations).toHaveLength(1);
    expect(req.perturbations[0]!.template).toBe(push.phrase);
    expect(req.perturbations[0]!.params).toMatchObject({ force: 'push.force', duration: 0.2 });
    expect(req.horizon).toBeCloseTo(3.2, 12);
    expect(req.monitor(trace(1)).robustness).toBeCloseTo(0.5, 12);
    expect(req.monitor(trace(0.2)).robustness).toBeLessThan(0);
  });

  it('compiles an unwanted requirement and takes the id from the options', () => {
    const r = compileRequirement(
      'IF the pelvis is pushed with 150 to 250 N for 0.1 s from any direction THEN THE robot SHALL stay upright for 2 s',
      lex(), { id: '4.1' },
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement!.id).toBe('4.1');
    expect(r.requirement!.pattern).toBe('unwanted');
    expect(r.requirement!.space.dims[0]).toEqual({ name: 'push.force', kind: 'force', min: 150, max: 250, severity: 'up' });
    expect(r.requirement!.horizon).toBeCloseTo(2.1, 12);
  });

  it('compiles a ubiquitous requirement with an empty id and the 10 s default horizon', () => {
    const r = compileRequirement('THE robot SHALL stay upright', lex());
    expect(r.diagnostics).toEqual([]);
    expect(r.requirement).toMatchObject({ id: '', pattern: 'ubiquitous', horizon: 10 });
    expect(r.requirement!.space.dims).toEqual([]);
    expect(r.requirement!.perturbations).toEqual([]);
  });

  it('compiles a state requirement: when the state holds the response must hold', () => {
    const r = compileRequirement('WHILE be on the ground THE robot SHALL stay upright', lex());
    expect(r.diagnostics).toEqual([]);
    const req = r.requirement!;
    expect(req.pattern).toBe('state');
    expect(req.monitor(trace(0.1)).robustness).toBeLessThan(0);
  });

  it('is vacuously satisfied for a WHERE feature that is not enabled', () => {
    const line = 'WHERE suction cup THE robot SHALL stay upright';
    const off = compileRequirement(line, lex(), { enabledFeatures: [] }).requirement!;
    expect(off.pattern).toBe('optional');
    expect(off.monitor(trace(0.1)).robustness).toBe(Infinity);
    const on = compileRequirement(line, lex(), { enabledFeatures: ['Suction  cup'] }).requirement!;
    expect(on.monitor(trace(0.1)).robustness).toBeLessThan(0);
  });

  it('lets episodeSeconds override the Lexicon and the default', () => {
    const line = 'THE robot SHALL stay upright';
    expect(compileRequirement(line, lex({ episodeSeconds: 6 })).requirement!.horizon).toBe(6);
    expect(compileRequirement(line, lex({ episodeSeconds: 6 }), { episodeSeconds: 4 }).requirement!.horizon).toBe(4);
  });

  it('reports a duplicate dimension name and returns no requirement', () => {
    const r = compileRequirement('WHEN the arm is shaken with up to 5 N THE robot SHALL stay upright for 1 s', lex());
    expect(r.requirement).toBeUndefined();
    expect(r.diagnostics.some((d) => d.severity === 'error' && /x\.force/.test(d.message))).toBe(true);
  });

  it('returns no requirement and sorted diagnostics for an unknown phrase', () => {
    const r = compileRequirement('WHEN the pelvis is poked THE robot SHALL fly', lex());
    expect(r.requirement).toBeUndefined();
    const starts = r.diagnostics.map((d) => d.start);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
