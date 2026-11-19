import { describe, expect, it } from 'vitest';
import { BOWLS, HAND_START, TABLE, TRAY } from '../constants';
import {
  bowlAt, chooseCandy, classifyCandies, handPose, inTray, inWorkspace, makeCandyStates, nearestBowl, resolveOverlaps, tableEdgePoint,
  type CandyCounts,
} from '../geometry';

const counts = (): CandyCounts => ({ sorted: 0, misplaced: 0, droppedOutside: 0, active: 0 });
const pose = (t: number, v: { angle: number; speed: number; entry: number; height: number }, tTrig = 1) => {
  const o = new Float64Array(4); handPose(o, t, tTrig, v); return Array.from(o);
};

describe('classifyCandies', () => {
  it('counts a resting candy in the bowl of its colour as sorted and in another bowl as misplaced', () => {
    const c = makeCandyStates();
    c.forEach((s) => { s.active = false; });
    c[0] = { x: BOWLS[0]!.x, y: BOWLS[0]!.y, z: 0.02, speed: 0.01, colour: 0, active: true };
    c[1] = { x: BOWLS[2]!.x, y: BOWLS[2]!.y, z: 0.02, speed: 0.0, colour: 1, active: true };
    expect(classifyCandies(c, counts())).toEqual({ sorted: 1, misplaced: 1, droppedOutside: 0, active: 2 });
  });
  it('leaves a candy that moves faster than 0.05 m/s out of sorted and misplaced', () => {
    const c = makeCandyStates();
    c[0] = { x: BOWLS[1]!.x, y: BOWLS[1]!.y, z: 0.02, speed: 0.0501, colour: 1, active: true };
    const r = classifyCandies(c, counts());
    expect(r.sorted).toBe(0);
    expect(r.misplaced).toBe(0);
  });
  it('does not count a candy carried at 0.15 m as dropped, and counts one on the floor', () => {
    const c = makeCandyStates();
    c.forEach((s) => { s.active = false; });
    c[0] = { x: 0.9, y: 0.9, z: 0.15, speed: 0.5, colour: 0, active: true };
    c[1] = { x: 0.9, y: 0.9, z: -0.38, speed: 0, colour: 0, active: true };
    c[2] = { x: 0.5, y: 0, z: 0.01, speed: 0, colour: 0, active: true };      // on the tray
    c[3] = { x: 0.9, y: -0.3, z: 0.01, speed: 0, colour: 0, active: true };   // on the table, off the tray
    expect(classifyCandies(c, counts())).toEqual({ sorted: 0, misplaced: 0, droppedOutside: 2, active: 4 });
  });
  it('finds the bowl of a point', () => {
    expect(bowlAt(BOWLS[1]!.x, BOWLS[1]!.y, 0.02)).toBe(1);
    expect(bowlAt(BOWLS[1]!.x + 0.0701, BOWLS[1]!.y, 0.02)).toBe(-1);
    expect(bowlAt(BOWLS[1]!.x, BOWLS[1]!.y, 0.07)).toBe(-1);
    expect(inTray(0.5, 0)).toBe(true);
    expect(inTray(0.2, 0)).toBe(false);
    expect(inWorkspace(0.55, 0, 0.2)).toBe(true);
    expect(inWorkspace(HAND_START.x, HAND_START.y, HAND_START.z)).toBe(false);
  });
});

describe('handPose', () => {
  const v = { angle: Math.PI / 2, speed: 0.8, entry: 0.5, height: 0.15 };
  it('holds the start pose before the entry time', () => {
    expect(pose(0, v)).toEqual([HAND_START.x, HAND_START.y, HAND_START.z, HAND_START.yaw]);
    expect(pose(1.49, v)).toEqual([HAND_START.x, HAND_START.y, HAND_START.z, HAND_START.yaw]);
  });
  it('appears on the Table edge at the entry time and heads for the nearest bowl', () => {
    const p = pose(1.5, v);
    expect(p[0]).toBeCloseTo(0.55, 9);            // from the workspace centre along +y: x stays 0.55
    expect(p[1]).toBeCloseTo(TABLE.yMax, 9);
    expect(p[2]).toBe(0.15);
    expect(p[3]).toBe(Math.PI / 2);
    const q = pose(1.5 + 0.25, v);
    const moved = Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!);
    expect(moved).toBeCloseTo(0.8 * 0.25, 9);
  });
  it('holds at the bowl centre after arriving', () => {
    const p = pose(100, v);
    expect(p[0]).toBeCloseTo(BOWLS[2]!.x, 9);
    expect(p[1]).toBeCloseTo(BOWLS[2]!.y, 9);
  });
  it('enters from the side toward the green bowl for +y and the orange bowl for -y', () => {
    const e = new Float64Array(2);
    tableEdgePoint(Math.PI / 2, e);
    expect(nearestBowl(e[0]!, e[1]!)).toBe(2);
    tableEdgePoint(-Math.PI / 2, e);
    expect(nearestBowl(e[0]!, e[1]!)).toBe(0);
    tableEdgePoint(0, e);
    expect(e[0]).toBeCloseTo(TABLE.xMax, 9);
    expect(nearestBowl(e[0]!, e[1]!)).toBe(1);
  });
});

describe('resolveOverlaps', () => {
  it('spreads six candies from one point so that the last ends at x <= 0.59 m, inside the tray', () => {
    const xy = new Float64Array(12);
    for (let i = 0; i < 6; i++) { xy[2 * i] = 0.39; xy[2 * i + 1] = 0; }
    resolveOverlaps(xy);
    expect(xy[10]).toBeLessThanOrEqual(0.59 + 1e-9);
    expect(xy[10]).toBeLessThan(TRAY.xMax);
    expect(Array.from({ length: 6 }, (_, i) => Number(xy[2 * i]!.toFixed(2)))).toEqual([0.39, 0.43, 0.47, 0.51, 0.55, 0.59]);
  });
  it('leaves candies that are far apart alone', () => {
    const xy = Float64Array.from([0.35, -0.12, 0.35, -0.04, 0.35, 0.04, 0.35, 0.12, 0.39, -0.12, 0.39, 0.12]);
    const copy = Float64Array.from(xy);
    resolveOverlaps(xy);
    expect(Array.from(xy)).toEqual(Array.from(copy));
  });
});

describe('chooseCandy', () => {
  const pos = (list: number[][]) => Float64Array.from(list.flat());
  const all = Uint8Array.from([1, 1, 1, 1, 1, 1]);
  const none = new Uint8Array(6);
  it('picks the candy nearest the base axis and the lower id on ties', () => {
    const p = pos([[0.5, 0, 0.01], [0.4, 0, 0.01], [0.4, 0, 0.01], [0.6, 0, 0.01], [0.5, 0.1, 0.01], [0.45, 0.05, 0.01]]);
    expect(chooseCandy(p, all, none)).toBe(1);
  });
  it('skips masked candies, inactive candies and candies off the tray or in the air', () => {
    const p = pos([[0.4, 0, 0.01], [0.41, 0, 0.01], [0.42, 0, 0.01], [0.43, 0, 0.01], [0.5, 0, 0.01], [0.9, 0, 0.01]]);
    expect(chooseCandy(p, Uint8Array.from([0, 1, 1, 1, 1, 1]), Uint8Array.from([0, 1, 0, 0, 0, 0]))).toBe(2);
    p[8] = 0.2;   // candy 2 is lifted
    expect(chooseCandy(p, Uint8Array.from([0, 1, 1, 1, 1, 1]), Uint8Array.from([0, 1, 0, 0, 0, 0]))).toBe(3);
  });
  it('returns -1 when no candy is on the tray', () => {
    const p = pos([[0.9, 0, 0], [0.9, 0, 0], [0.9, 0, 0], [0.9, 0, 0], [0.9, 0, 0], [0.9, 0, 0]]);
    expect(chooseCandy(p, all, none)).toBe(-1);
  });
});
