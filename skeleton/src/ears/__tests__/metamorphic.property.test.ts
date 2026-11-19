// Improvement 6 of golem-ears-hardening: metamorphic properties. Spellings that mean the same
// requirement must compile to the same space, parameters, horizon, formula and monitor results.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { CompiledRequirement, Trace } from '../types.js';
import { g1Lexicon } from './g1Lexicon.js';
import { propConfig } from './support.js';

const lex = g1Lexicon();

interface Push {
  pattern: 'event' | 'unwanted';
  lo?: number; // N, below hi
  hi: number; // N
  ms: number; // trigger duration
  direction: string;
  phase: string;
  response: string;
}

interface Spelling {
  kN: boolean; // forces in kN
  bothUnits: boolean; // "150 N to 250 N" instead of "150 to 250 N"
  seconds: boolean; // duration in s instead of ms
  upper: boolean; // keyword case
  comma: boolean; // comma before THE (or THEN)
  period: boolean; // trailing period
  bold: boolean; // **robot**
  then: boolean; // THEN before THE in a WHEN line
}

const arbPush: fc.Arbitrary<Push> = fc.record({
  pattern: fc.constantFrom<'event' | 'unwanted'>('event', 'unwanted'),
  hi: fc.integer({ min: 2, max: 999 }),
  loFrac: fc.option(fc.integer({ min: 1, max: 99 }), { nil: undefined }),
  ms: fc.integer({ min: 1, max: 999 }),
  direction: fc.oneof(fc.constantFrom('any direction', 'behind'), fc.integer({ min: 0, max: 359 }).map((d) => `${d} deg`)),
  phase: fc.oneof(fc.constant('any point in its stride'), fc.integer({ min: 0, max: 100 }).map((p) => `${p}%`)),
  response: fc.oneof(
    fc.integer({ min: 1, max: 9 }).map((s) => `stay upright for ${s} s`),
    fc.tuple(fc.integer({ min: 10, max: 90 }), fc.integer({ min: 1, max: 9 })).map(([cm, s]) => `keep its pelvis above ${cm} cm within ${s} s`),
    fc.constant('stay upright'),
  ),
}).map(({ loFrac, ...p }) => (loFrac === undefined ? p : { ...p, lo: Math.max(1, Math.floor((p.hi * loFrac) / 100)) }));

const arbSpelling: fc.Arbitrary<Spelling> = fc.record({
  kN: fc.boolean(), bothUnits: fc.boolean(), seconds: fc.boolean(), upper: fc.boolean(),
  comma: fc.boolean(), period: fc.boolean(), bold: fc.boolean(), then: fc.boolean(),
});

const CANONICAL: Spelling = {
  kN: false, bothUnits: false, seconds: false, upper: true, comma: true, period: false, bold: false, then: false,
};

/** kN text of a whole number of newtons; exact for integers below 1000. */
const kn = (n: number): string => String(n / 1000);

function write(p: Push, s: Spelling): string {
  const f = (n: number): string => (s.kN ? kn(n) : String(n));
  const u = s.kN ? 'kN' : 'N';
  const force = p.lo === undefined
    ? `up to ${f(p.hi)} ${u}`
    : s.bothUnits ? `${f(p.lo)} ${u} to ${f(p.hi)} ${u}` : `${f(p.lo)} to ${f(p.hi)} ${u}`;
  const dur = s.seconds ? `${p.ms / 1000} s` : `${p.ms} ms`;
  const k = (w: string) => (s.upper ? w.toUpperCase() : w.toLowerCase());
  const trigger = `the pelvis is pushed with ${force} for ${dur} from ${p.direction} at ${p.phase}`;
  const robot = s.bold ? '**golem**' : 'golem';
  const sep = s.comma ? ',' : '';
  const head = p.pattern === 'unwanted'
    ? `${k('IF')} ${trigger}${sep} ${k('THEN')} ${k('THE')}`
    : `${k('WHEN')} ${trigger}${sep}${s.then ? ` ${k('THEN')}` : ''} ${k('THE')}`;
  return `${head} ${robot} ${k('SHALL')} ${p.response}${s.period ? '.' : ''}`;
}

const near = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b));

function expectSame(a: CompiledRequirement, b: CompiledRequirement, traces: Trace[]): void {
  expect(b.pattern).toBe(a.pattern);
  expect(b.formula).toBe(a.formula);
  expect(near(b.horizon, a.horizon)).toBe(true);
  expect(b.space.dims.map((d) => [d.name, d.kind, d.severity, d.wrap])).toEqual(a.space.dims.map((d) => [d.name, d.kind, d.severity, d.wrap]));
  a.space.dims.forEach((d, i) => {
    expect(near(b.space.dims[i]!.min, d.min)).toBe(true);
    expect(near(b.space.dims[i]!.max, d.max)).toBe(true);
  });
  expect(b.perturbations.length).toBe(a.perturbations.length);
  a.perturbations.forEach((pa, i) => {
    const pb = b.perturbations[i]!;
    expect(pb.template).toBe(pa.template);
    expect(Object.keys(pb.params).sort()).toEqual(Object.keys(pa.params).sort());
    for (const [key, v] of Object.entries(pa.params)) {
      const w = pb.params[key]!;
      if (typeof v === 'string') expect(w).toBe(v);
      else expect(near(w as number, v)).toBe(true);
    }
  });
  for (const tr of traces) {
    const ra = a.monitor(tr);
    const rb = b.monitor(tr);
    expect(Object.is(rb.robustness, ra.robustness)).toBe(true);
    expect(Object.is(rb.worstAt, ra.worstAt)).toBe(true);
    expect(rb.unit).toBe(ra.unit);
  }
}

/** 12 s traces from 2 s at 50 Hz (601 samples) with a trigger at 2 s; heights from a small pool. */
const arbTraces: fc.Arbitrary<Trace[]> = fc.array(
  fc.array(fc.constantFrom(0.1, 0.3, 0.5, 0.78), { minLength: 1, maxLength: 40 }).map((zs): Trace => {
    const n = 601;
    const t = new Float64Array(n);
    const z = new Float64Array(n);
    const tilt = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      t[i] = 2 + i / 50;
      z[i] = zs[Math.floor((i * zs.length) / n)]!;
      tilt[i] = z[i]! < 0.5 ? 70 : 5;
    }
    return { t, signals: { pelvis_z: z, tilt_deg: tilt }, events: [{ name: 'trigger', t: 2 }] };
  }),
  { minLength: 1, maxLength: 3 },
);

describe('Metamorphic properties of the compiler (golem-ears-hardening I6)', () => {
  it('compiles equivalent spellings of a push requirement to the same requirement', () => {
    fc.assert(
      fc.property(arbPush, arbSpelling, arbTraces, (p, s, traces) => {
        const a = compileRequirement(write(p, CANONICAL), lex);
        const b = compileRequirement(write(p, s), lex);
        expect(a.diagnostics).toEqual([]);
        expect(b.diagnostics).toEqual([]);
        expectSame(a.requirement!, b.requirement!, traces);
      }),
      propConfig,
    );
  });

  it('treats 50 cm, 0.5 m and 500 mm as the same threshold', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), arbTraces, (cm, traces) => {
        const forms = [`${cm} cm`, `${cm / 100} m`, `${cm * 10} mm`];
        const reqs = forms.map((q) => compileRequirement(`THE golem SHALL keep its pelvis above ${q} for 5 s`, lex).requirement!);
        for (const tr of traces) {
          const [r0, ...rest] = reqs.map((q) => q.monitor(tr));
          for (const r of rest) {
            expect(near(r.robustness, r0!.robustness)).toBe(true);
            expect(r.worstAt).toBe(r0!.worstAt);
          }
        }
      }),
      propConfig,
    );
  });

  it('gives the same result for an ID written as R<n>., <n>.<m> or from the options', () => {
    fc.assert(
      fc.property(arbPush, fc.integer({ min: 1, max: 99 }), (p, n) => {
        const body = write(p, CANONICAL);
        const viaLine = compileRequirement(`${n}.1 ${body}`, lex).requirement!;
        const viaOptions = compileRequirement(body, lex, { id: `${n}.1` }).requirement!;
        expect(viaLine.id).toBe(`${n}.1`);
        expect(viaOptions.id).toBe(`${n}.1`);
        expectSame(viaLine, viaOptions, []);
      }),
      propConfig,
    );
  });
});
