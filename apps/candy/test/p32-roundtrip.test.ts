// Feature: candy-app, Property 32: Parser round trip over candy phrases
import fc from 'fast-check';
import { compileRequirement, format, parse, tokenize } from 'golem-spec';
import { describe, expect, it } from 'vitest';
import { lexicon } from '../lexicon';

const num = (min: number, max: number, digits = 2) => fc.integer({ min: Math.round(min * 10 ** digits), max: Math.round(max * 10 ** digits) }).map((n) => String(n / 10 ** digits));

/** Phrases of the candy lexicon with generated quantities that carry units. */
const speed = fc.oneof(
  num(0.1, 1.5).map((v) => `up to ${v} m/s`),
  fc.tuple(num(0.1, 0.7), num(0.8, 1.5)).map(([a, b]) => `${a} m/s to ${b} m/s`),
  num(0.1, 1.5).map((v) => `${v} m/s`),
);
const direction = fc.oneof(fc.constant('any direction'), fc.constant('behind'), fc.integer({ min: 0, max: 359 }).map((d) => `${d} deg`));
const perturbation = fc.oneof(
  fc.tuple(direction, speed).map(([d, s]) => `a hand reaches in from ${d} at ${s}`),
  fc.tuple(num(0.005, 0.02, 3), num(0.03, 0.06, 3)).map(([a, b]) => `the candies weigh ${a} kg to ${b} kg`),
  fc.tuple(fc.integer({ min: 10, max: 60 }), fc.integer({ min: 70, max: 100 })).map(([a, b]) => `the vacuum weakens to ${a}% to ${b}%`),
  num(0.02, 0.3).map((v) => `the hand tracker lags by up to ${v} s`),
  fc.constant('candies land anywhere on the tray'),
  fc.tuple(num(0.02, 0.3), direction, speed).map(([l, d, s]) => `the hand tracker lags by up to ${l} s and a hand reaches in from ${d} at ${s}`),
);
const predicate = fc.oneof(
  num(0.01, 0.5).map((v) => `keep every link at least ${v} m from the hand`),
  num(0.1, 2).map((v) => `keep its fastest link below ${v} m/s`),
  fc.constant('not drop a candy outside the bowls'),
  num(1, 200, 1).map((v) => `never press on the table with more than ${v} N`),
  fc.integer({ min: 5, max: 90 }).map((v) => `drop every candy into the bowl of its colour within ${v} s`),
);
const robot = fc.constantFrom(...lexicon.robotNames);
const id = fc.integer({ min: 1, max: 9 }).chain((a) => fc.integer({ min: 1, max: 9 }).map((b) => `${a}.${b}`));
const line = fc.tuple(id, robot, perturbation, predicate, fc.boolean()).map(([i, r, p, q, ubiquitous]) =>
  (ubiquitous ? `${i} THE ${r} SHALL ${q}` : `${i} WHEN ${p} THE ${r} SHALL ${q}`));

/**
 * Drops every position field, upper-cases keyword tokens and replaces a clause's source text by its tokens joined the
 * way format() prints them, so that ASTs compare by content. (The same comparison golem-ears uses for its own round trip.)
 */
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v === null || typeof v !== 'object') return v;
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) {
    if (['start', 'end', 'line', 'column', 'span', 'offset'].includes(k)) continue;
    out[k] = src.type === 'keyword' && k === 'text' && typeof src[k] === 'string' ? (src[k] as string).toUpperCase() : strip(src[k]);
  }
  if (typeof src.text === 'string' && Array.isArray(src.tokens)) {
    let s = '';
    for (const t of src.tokens as { type: string; text: string }[]) s += t.type === 'comma' ? ',' : (s === '' ? '' : ' ') + t.text;
    out.text = s;
  }
  return out;
}

describe('parser round trip over candy phrases', () => {
  it('re-parses format(parse(line)) to an equal AST', () => {
    fc.assert(fc.property(line, (text) => {
      const t1 = tokenize(text);
      expect(t1.diagnostics).toEqual([]);
      const first = parse(t1.tokens, lexicon.robotNames, text);
      expect(first.diagnostics).toEqual([]);
      const printed = format(first.ast!);
      const t2 = tokenize(printed);
      expect(t2.diagnostics).toEqual([]);
      const second = parse(t2.tokens, lexicon.robotNames, printed);
      expect(second.diagnostics).toEqual([]);
      expect(strip(second.ast)).toEqual(strip(first.ast));
      expect(format(second.ast!)).toBe(printed);
    }), { numRuns: 300 });
  });

  it('compiles the same requirement from the printed line as from the written one when the line is valid', () => {
    fc.assert(fc.property(line, (text) => {
      const a = compileRequirement(text, lexicon);
      fc.pre(a.diagnostics.length === 0);
      const printed = format(parse(tokenize(text).tokens, lexicon.robotNames, text).ast!);
      const b = compileRequirement(printed, lexicon);
      expect(b.diagnostics).toEqual([]);
      expect(b.requirement!.space).toEqual(a.requirement!.space);
      expect(b.requirement!.horizon).toBe(a.requirement!.horizon);
    }), { numRuns: 200 });
  });
});
