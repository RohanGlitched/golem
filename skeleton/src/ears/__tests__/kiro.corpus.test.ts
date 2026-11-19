// Improvement 3 of golem-ears-hardening: a Kiro-compatibility golden corpus.
// (1) Real Kiro output styles compiled with a realistic G1 lexicon, with exact expectations.
// (2) Every requirements.md under .kiro/specs/ of this repository, summarised and compared with a
//     committed golden file, plus invariants that no diagnostic comes from Kiro markup.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileRequirementsFile } from '../compile.js';
import { extractCriteria } from '../extract.js';
import { g1Lexicon, PAYLOAD_PHRASE, PUSH_PHRASE, SLOPE_PHRASE } from './g1Lexicon.js';

const here = dirname(fileURLToPath(import.meta.url));
const lex = g1Lexicon({ features: ['the payload kit is fitted'] });
const r12 = (x: number): number => Number(x.toPrecision(12));
const PI = Math.PI;

describe('Kiro output styles', () => {
  const md = readFileSync(join(here, '__fixtures__', 'kiro-styles.md'), 'utf8');
  const f = compileRequirementsFile(md, lex);

  it('compiles every criterion with no diagnostic', () => {
    expect(f.diagnostics).toEqual([]);
    expect(f.requirements.map((q) => q.id)).toEqual(['1.1', '1.2', '1.3', '1.4', '2.1', '2.2', '2.3', '2.4', '2.5']);
  });

  it('gives each criterion the exact pattern, space, parameters, horizon and formula', () => {
    const summary = f.requirements.map((q) => ({
      id: q.id,
      pattern: q.pattern,
      dims: q.space.dims.map((d) => [d.name, r12(d.min), r12(d.max), d.severity, d.wrap === true]),
      perturbations: q.perturbations.map((p) => ({
        template: p.template,
        params: Object.fromEntries(Object.entries(p.params).map(([k, v]) => [k, typeof v === 'number' ? r12(v) : v])),
      })),
      horizon: r12(q.horizon),
      formula: q.formula,
    }));
    const pushParams = (extra: Record<string, string | number>) => ({ force: 'push.force', direction: 'push.angle', phase: 'push.phase', ...extra });
    expect(summary).toEqual([
      {
        id: '1.1', pattern: 'event',
        dims: [['push.force', 0, 200, 'up', false], ['push.angle', 0, r12(2 * PI), 'none', true], ['push.phase', 0, 1, 'none', true]],
        perturbations: [{ template: PUSH_PHRASE, params: pushParams({ duration: 0.2 }) }],
        horizon: 3.2, formula: 'G[t₀, t₀+3 s] margin("stay upright") > 0 m',
      },
      {
        id: '1.2', pattern: 'event',
        dims: [['push.force', 150, 250, 'up', false], ['push.angle', r12(3 * PI / 4), r12(5 * PI / 4), 'none', true], ['push.phase', 0, 1, 'none', true]],
        perturbations: [{ template: PUSH_PHRASE, params: pushParams({ duration: 0.2 }) }],
        horizon: 3.2, formula: 'G[t₀, t₀+3 s] margin("keep its pelvis above 0.6 m") > 0 m',
      },
      {
        id: '1.3', pattern: 'unwanted',
        dims: [['push.force', 0, 300, 'up', false], ['push.angle', r12(3 * PI / 4), r12(5 * PI / 4), 'none', true], ['push.phase', 0.62, 0.62, 'none', true]],
        perturbations: [{ template: PUSH_PHRASE, params: pushParams({ duration: 0.1, phase: 0.62 }) }],
        horizon: 12.1, formula: 'F[t₀, t₀+6 s] G[·, t_end] margin("keep its pelvis above 50 cm") > 0 m',
      },
      {
        id: '1.4', pattern: 'event',
        dims: [['push.force', 0, 200, 'up', false], ['push.angle', r12(PI / 2), r12(PI / 2), 'none', false], ['push.phase', 0, 1, 'none', true]],
        perturbations: [{ template: PUSH_PHRASE, params: pushParams({ duration: 0.2, direction: r12(PI / 2) }) }],
        horizon: 3.2, formula: 'G[t₀, t₀+3 s] margin("stay upright") > 0 m',
      },
      {
        id: '2.1', pattern: 'ubiquitous', dims: [], perturbations: [], horizon: 10,
        formula: 'G[t_start, t_end] margin("track the commanded speed within 0.15 m/s") > 0 m/s',
      },
      {
        id: '2.2', pattern: 'state',
        dims: [['slope.angle', 0, r12(PI / 18), 'up', false]],
        perturbations: [{ template: SLOPE_PHRASE, params: { angle: 'slope.angle' } }],
        horizon: 10, formula: 'G[t_start, t_end] margin("stay upright") > 0 m, with "walking on a slope of up to 10°" applied throughout',
      },
      {
        id: '2.3', pattern: 'state', dims: [], perturbations: [], horizon: 10,
        formula: 'G[t_start, t_end] (margin("keep its pelvis above 0.4 m") > 0 m → G[t, t+2 s] margin("track the commanded speed within 15 cm/s") > 0 m/s)',
      },
      {
        id: '2.4', pattern: 'optional', dims: [], perturbations: [], horizon: 10,
        formula: 'true (feature "the payload kit is fitted" is not enabled)',
      },
      {
        id: '2.5', pattern: 'state',
        dims: [['payload.mass', 0, 5, 'up', false]],
        perturbations: [{ template: PAYLOAD_PHRASE, params: { mass: 'payload.mass' } }],
        horizon: 10, formula: 'G[t_start, t_end] margin("stay upright") > 0 m, with "carrying a payload of up to 5 kg" applied throughout',
      },
    ]);
  });

  it('keeps each requirement source as written in the file', () => {
    expect(f.requirements[2]!.source).toBe('IF the pelvis is pushed with up to 300 N for 0.1 s from behind at 62% of its stride, THEN THE robot SHALL keep its pelvis above `50 cm` within 6 s.');
    expect(f.requirements[3]!.source).toBe('WHEN the pelvis is pushed with up to 200 N for 0.2 s from 90 deg at any point in its stride, THE **Unitree G1** SHALL stay upright for 3 s.');
  });
});

// ---------- every requirements.md in this repository ----------

const specsDir = join(here, '..', '..', '..', '..', '.kiro', 'specs');
const specFiles = existsSync(specsDir)
  ? readdirSync(specsDir).filter((d) => existsSync(join(specsDir, d, 'requirements.md'))).sort().map((d) => `${d}/requirements.md`)
  : [];

/** Numbered lines under "#### Acceptance Criteria" that start (after markup) with an EARS keyword. */
function countEarsLines(text: string): number {
  let inAc = false;
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,4} /.test(line)) { inAc = /^#### Acceptance Criteria\s*$/.test(line); continue; }
    if (inAc && /^\s*\d+[.)]\s+(?:[*`]|__)*(?:WHEN|WHILE|IF|WHERE|THE)(?![\p{L}\p{N}_])/iu.test(line)) n++;
  }
  return n;
}

describe.skipIf(specFiles.length === 0)('repository specs', () => {
  const results = specFiles.map((file) => {
    const text = readFileSync(join(specsDir, file), 'utf8');
    return { file, text, ex: extractCriteria(text), out: compileRequirementsFile(text, lex) };
  });

  it('extracts every EARS criterion of every requirements.md', () => {
    for (const r of results) expect(r.ex.criteria.length, r.file).toBe(countEarsLines(r.text));
  });

  it('never reports a trailing period or Markdown markup as an error', () => {
    const bad: string[] = [];
    for (const r of results) {
      const ends = new Set(r.ex.criteria.map((c) => {
        const s = c.segments[c.segments.length - 1]!;
        return s.offset + s.length;
      }));
      for (const d of r.out.diagnostics) {
        if (!d.message.startsWith('Unexpected character')) continue;
        const ch = r.text.slice(d.start, d.end);
        if (ch === '*' || ch === '`' || (ch === '.' && ends.has(d.end))) bad.push(`${r.file}:${d.line}:${d.column} ${d.message}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('either compiles each criterion or reports an error inside it', () => {
    const silent: string[] = [];
    for (const r of results) {
      const compiled = new Set(r.out.requirements.map((q) => q.id));
      const errors = r.out.diagnostics.filter((d) => d.severity === 'error');
      for (const c of r.ex.criteria) {
        if (compiled.has(c.id)) continue;
        const lastSeg = c.segments[c.segments.length - 1]!;
        if (!errors.some((d) => d.start >= c.offset && d.start <= lastSeg.offset + lastSeg.length)) silent.push(`${r.file} ${c.id}`);
      }
    }
    expect(silent).toEqual([]);
  });

  it('matches the golden summary', async () => {
    const golden = results.map((r) => {
      const compiled = new Map(r.out.requirements.map((q) => [q.id, q]));
      return {
        file: r.file,
        criteria: r.ex.criteria.map((c) => {
          const q = compiled.get(c.id);
          const lastSeg = c.segments[c.segments.length - 1]!;
          const first = r.out.diagnostics.find((d) => d.start >= c.offset && d.start <= lastSeg.offset + lastSeg.length);
          return {
            id: c.id,
            line: c.line,
            compiled: q !== undefined,
            ...(q ? { pattern: q.pattern, formula: q.formula } : {}),
            ...(first ? { first: `${first.kind} ${first.line}:${first.column} ${first.message}` } : {}),
          };
        }),
      };
    });
    await expect(`${JSON.stringify(golden, null, 1)}\n`).toMatchFileSnapshot(join(here, '__fixtures__', 'repo-corpus.golden.json'));
  });
});
