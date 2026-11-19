// Feature: candy-app, Property 38: the studio's dragged Hand stays in its band and out of the base column
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BASE_KEEP_OUT, HAND_DRAG_AREA, HAND_HEIGHT_RANGE, HAND_START } from '../constants';
import { constrainDraggedHand } from '../geometry';

const coord = fc.double({ min: -5, max: 5, noNaN: true });

describe('constrainDraggedHand', () => {
  it('leaves a point beside the Table, in the height band, unchanged', () => {
    expect(constrainDraggedHand([0.9, 0.4, 0.15])).toEqual([0.9, 0.4, 0.15]);
  });
  it('lowers a hand held above 0.25 m and raises one below 0.05 m', () => {
    expect(constrainDraggedHand([0.9, 0.4, 0.30])[2]).toBe(HAND_HEIGHT_RANGE.max);
    expect(constrainDraggedHand([0.9, 0.4, 0.0])[2]).toBe(HAND_HEIGHT_RANGE.min);
  });
  it('pushes a point over the base axis out along +x, and a point inside the column out along its radius', () => {
    expect(constrainDraggedHand([0, 0, 0.1])).toEqual([BASE_KEEP_OUT, 0, 0.1]);
    const [x, y] = constrainDraggedHand([0, 0.05, 0.1]);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(BASE_KEEP_OUT, 12);
  });
  it('treats a non-finite coordinate as the start value of the Hand', () => {
    const [x, y, z] = constrainDraggedHand([Number.NaN, Number.POSITIVE_INFINITY, Number.NaN]);
    expect(x).toBe(HAND_START.x);
    expect(y).toBe(HAND_START.y);
    expect(z).toBe(HAND_HEIGHT_RANGE.max);
  });
  it('property: the result is finite, in the area and the band, outside the base column, and a fixed point of itself', () => {
    fc.assert(fc.property(coord, coord, coord, (x, y, z) => {
      const p = constrainDraggedHand([x, y, z]);
      expect(p.every(Number.isFinite)).toBe(true);
      expect(p[2]).toBeGreaterThanOrEqual(HAND_HEIGHT_RANGE.min);
      expect(p[2]).toBeLessThanOrEqual(HAND_HEIGHT_RANGE.max);
      expect(Math.hypot(p[0], p[1])).toBeGreaterThanOrEqual(BASE_KEEP_OUT - 1e-12);
      expect(p[0]).toBeGreaterThanOrEqual(HAND_DRAG_AREA.xMin - 1e-12);
      expect(p[0]).toBeLessThanOrEqual(HAND_DRAG_AREA.xMax + 1e-12);
      expect(p[1]).toBeGreaterThanOrEqual(HAND_DRAG_AREA.yMin - 1e-12);
      expect(p[1]).toBeLessThanOrEqual(HAND_DRAG_AREA.yMax + 1e-12);
      const q = constrainDraggedHand(p);
      for (let i = 0; i < 3; i++) expect(q[i]).toBeCloseTo(p[i]!, 9);
    }), { numRuns: 300 });
  });
  it('property: a straight drag from one side of the base to the other never puts the Hand inside the column', () => {
    fc.assert(fc.property(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: 0.2, max: 1.2, noNaN: true }), (y0, x0) => {
      for (let s = 0; s <= 40; s++) {
        const x = x0 * (1 - s / 20); // from +x0 to -x0 across the base
        const p = constrainDraggedHand([x, y0, 0.15]);
        expect(Math.hypot(p[0], p[1])).toBeGreaterThanOrEqual(BASE_KEEP_OUT - 1e-12);
      }
    }), { numRuns: 100 });
  });
});
