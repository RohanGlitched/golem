import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { toSI } from '../../ears/index.js';
import { segmentLine } from '../tablet/segments.js';
import type { QuantityInfo } from '../tablet/segments.js';
import { commitTyped, dragQuantity, effectiveStep, formatSpan, rangeOf, rewriteSpan, stepDecimals, stepQuantity } from '../tablet/quantity-edit.js';
import { underlineRanges } from '../tablet/diagnostics-view.js';
import { decimalsOf } from '../core/format.js';
import { UNIT_TABLE } from '../../ears/units.js';
import { UNITS, arbLinePieces, piecesToLine } from './generators/line.js';
import type { Kind } from '../types.js';

const R = { numRuns: 100 };
const KW = new Set(['WHEN', 'WHILE', 'IF', 'THEN', 'WHERE', 'THE', 'SHALL']);
const kindOf = (u: string): Kind => UNIT_TABLE.find((x) => x.spelling === u)!.kind;
const arbUnit = fc.constantFrom(...UNITS);
const arbMod = fc.constantFrom('none' as const, 'shift' as const, 'alt' as const);

describe('tablet logic properties', () => {
  // Feature: golem-studio-ui, Property 29: Tablet text display
  it('segments cover the line exactly, keywords are EARS keywords and quantities match the parser', () => {
    fc.assert(fc.property(arbLinePieces, (pieces) => {
      const line = 'WHEN ' + piecesToLine(pieces);
      const segs = segmentLine(line);
      expect(segs.map((s) => s.text).join('')).toBe(line);
      let pos = 0;
      for (const s of segs) {
        expect(s.start).toBe(pos);
        expect(s.end).toBe(s.start + s.text.length);
        expect(s.end).toBeGreaterThan(s.start);
        pos = s.end;
        if (s.kind === 'keyword') expect(KW.has(s.text)).toBe(true);
      }
      expect(pos).toBe(line.length);
      expect(segs.filter((s) => s.kind === 'quantity').length).toBe(pieces.filter((p) => p.t === 'q').length);
    }), R);
  });

  // Feature: golem-studio-ui, Property 30: Quantity step round trip
  it('steps up then down back to the value without binary noise', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100000 }), fc.integer({ min: 0, max: 3 }), arbUnit, arbMod, fc.array(fc.constantFrom(1 as const, -1 as const), { maxLength: 30 }), (n, wd, unit, mod, dirs) => {
      const v = n / 10 ** wd;
      const range = { min: -Infinity, max: Infinity };
      const step = effectiveStep(unit, mod);
      const up = stepQuantity(v, unit, 1, mod, range, wd);
      const back = stepQuantity(up, unit, -1, mod, range, wd);
      expect(Math.abs(back - v)).toBeLessThanOrEqual(10 ** -decimalsOf(step));
      let x = v;
      for (const d of dirs) {
        x = stepQuantity(x, unit, d, mod, range, wd);
        expect(decimalsOf(x)).toBeLessThanOrEqual(Math.max(decimalsOf(step), wd));
      }
      expect(stepQuantity(v, unit, 1, 'shift', range, wd) - v).toBeCloseTo(10 * effectiveStep(unit, 'none'), 9);
      expect(stepQuantity(v, unit, 1, 'alt', range, wd) - v).toBeCloseTo(0.1 * effectiveStep(unit, 'none'), 9);
      expect(stepDecimals(unit, mod, wd)).toBe(Math.max(decimalsOf(step), wd));
    }), R);
  });

  // Feature: golem-studio-ui, Property 31: Quantity clamp
  it('keeps every drag and step result inside the range of its kind', () => {
    fc.assert(fc.property(arbUnit, fc.double({ min: -50, max: 500, noNaN: true }), fc.array(fc.integer({ min: -2000, max: 2000 }), { maxLength: 10 }), fc.option(fc.record({ min: fc.integer({ min: 0, max: 20 }), max: fc.integer({ min: 30, max: 90 }) }), { nil: undefined }), (unit, start, drags, limits) => {
      const kind = kindOf(unit);
      const range = rangeOf(kind, unit, limits);
      const lo = kind === 'angle' || kind === 'ratio' ? 0 : 0;
      expect(range.min).toBeGreaterThanOrEqual(lo);
      if (unit === '%') expect(range.max).toBeLessThanOrEqual(100);
      const full = rangeOf(kind, unit);
      expect(range.min).toBeLessThanOrEqual(range.max);
      // Limits that do not intersect the kind's range cannot both hold; the kind's range wins.
      if (limits && limits.min <= full.max) { expect(range.min).toBeGreaterThanOrEqual(limits.min); expect(range.max).toBeLessThanOrEqual(limits.max); }
      for (const dx of drags) {
        const v = dragQuantity(start, dx, unit, 'none', { min: -Infinity, max: Infinity }, 2);
        expect(v).toBeCloseTo(start + Math.trunc(dx / 4) * effectiveStep(unit, 'none'), 1);
        const c = dragQuantity(start, dx, unit, 'none', range, 2);
        expect(c).toBeGreaterThanOrEqual(range.min);
        expect(c).toBeLessThanOrEqual(range.max);
        const s = stepQuantity(c, unit, dx > 0 ? 1 : -1, 'shift', range, 2);
        expect(s).toBeGreaterThanOrEqual(range.min);
        expect(s).toBeLessThanOrEqual(range.max);
      }
    }), R);
  });

  // Feature: golem-studio-ui, Property 32: Quantity rewrite touches only its span
  it('rewrites a quantity span and leaves everything else and the other segments as they were', () => {
    fc.assert(fc.property(arbLinePieces, fc.nat(), fc.integer({ min: 0, max: 9999 }), (pieces, pick, nv) => {
      const line = 'WHEN ' + piecesToLine(pieces);
      const segs = segmentLine(line);
      const qs = segs.filter((s) => s.kind === 'quantity');
      if (qs.length === 0) return;
      const q = qs[pick % qs.length]!;
      const info = q.q!;
      const value = nv / 100;
      const span = formatSpan(info, value, 2);
      const out = rewriteSpan(line, q.start, q.end, span);
      expect(out.slice(0, q.start)).toBe(line.slice(0, q.start));
      expect(out.slice(q.start + span.length)).toBe(line.slice(q.end));
      if (!info.inheritedUnit) expect(span.endsWith(info.gap + info.unit)).toBe(true);
      const after = segmentLine(out);
      const shift = span.length - (q.end - q.start);
      const strip = (ss: typeof segs) => ss.map((s) => `${s.kind}:${s.text}`);
      expect(strip(after.filter((s) => s.end <= q.start))).toEqual(strip(segs.filter((s) => s.end <= q.start)));
      expect(strip(after.filter((s) => s.start >= q.start + span.length))).toEqual(strip(segs.filter((s) => s.start >= q.end)));
      expect(after.filter((s) => s.start >= q.start + span.length).map((s) => s.start - shift))
        .toEqual(segs.filter((s) => s.start >= q.end).map((s) => s.start));
    }), R);
  });

  // Feature: golem-studio-ui, Property 33: Typed values with the wrong unit are rejected
  it('rejects a typed unit of another kind, uses the written unit for a bare number and converts the same kind', () => {
    fc.assert(fc.property(arbUnit, arbUnit, fc.integer({ min: 0, max: 5000 }), (written, typedUnit, n) => {
      const kind = kindOf(written);
      const info: QuantityInfo = { kind, unit: written, gap: ' ', numberText: '10', inheritedUnit: false, value: 10, decimals: 0 };
      const range = { min: -Infinity, max: Infinity };
      const v = n / 10;
      const r = commitTyped(`${v} ${typedUnit}`, info, range);
      if (kindOf(typedUnit) !== kind) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.message).toContain(`Write a${/^[aeiou]/.test(kind) ? 'n' : ''} ${kind}:`);
      } else {
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value).toBeCloseTo(toSI(v, typedUnit) / toSI(1, written), 9);
      }
      const bare = commitTyped(String(v), info, range);
      expect(bare.ok && bare.value).toBeCloseTo(v, 12);
      expect(commitTyped(`${v} furlongs`, info, range).ok).toBe(false);
    }), R);
  });

  // Feature: golem-studio-ui, Property 35: Diagnostic underline ranges
  it('returns clamped, ordered, disjoint, non-empty ranges that cover every diagnostic in the text', () => {
    const arbD = fc.record({ start: fc.integer({ min: -10, max: 80 }), len: fc.integer({ min: -3, max: 20 }) }).map(({ start, len }) => ({ start, end: start + len }));
    fc.assert(fc.property(fc.string({ maxLength: 60 }), fc.array(arbD, { maxLength: 8 }), (text, diags) => {
      const rs = underlineRanges(text, diags);
      let prev = -1;
      for (const r of rs) {
        expect(r.start).toBeGreaterThanOrEqual(0);
        expect(r.end).toBeLessThanOrEqual(text.length);
        expect(r.start).toBeLessThan(r.end);
        expect(r.start).toBeGreaterThanOrEqual(prev);
        prev = r.end;
      }
      for (const d of diags) {
        if (d.start < 0 || d.start >= text.length) continue;
        const s = d.start, e = Math.max(s + 1, Math.min(text.length, d.end));
        for (let i = s; i < e; i++) expect(rs.some((r) => r.start <= i && i < r.end)).toBe(true);
      }
    }), R);
  });
});
