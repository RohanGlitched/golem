import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lexicon } from '../lexicon';
import { noSideDrift, pelvisAbove, stayUpright, trackSpeed } from '../predicates';

describe('predicates', () => {
  it('declares the four phrases in order', () => {
    expect(lexicon.predicates.map((p) => p.phrase)).toEqual([
      'stay upright',
      'keep its pelvis above {length}',
      'track the commanded speed within {speed}',
      'not drift sideways more than {length}',
    ]);
  });

  it('declares the signals and units each predicate reads', () => {
    expect([stayUpright.signals, stayUpright.unit]).toEqual([['pelvis_z', 'tilt_deg'], 'm']);
    expect([pelvisAbove.signals, pelvisAbove.unit]).toEqual([['pelvis_z'], 'm']);
    expect([trackSpeed.signals, trackSpeed.unit]).toEqual([['forward_speed', 'commanded_speed', 'episode_time'], 'm/s']);
    expect([noSideDrift.signals, noSideDrift.unit]).toEqual([['lateral_drift'], 'm']);
  });

  it('documents the stay upright margin, the forced value and the reason above the template', () => {
    const src = readFileSync(new URL('../predicates.ts', import.meta.url), 'utf8');
    const at = src.indexOf('export const stayUpright');
    const comment = src.slice(src.lastIndexOf('/**', at), at);
    expect(comment).toContain('pelvis_z - 0.5 m');
    expect(comment).toContain('60 deg');
    expect(comment).toContain('-0.01 m');
    expect(comment).toMatch(/Reason:/);
  });

  it('gives pelvis_z - 0.5 m for stay upright when the tilt is at most 60 deg', () => {
    expect(stayUpright.margin({ pelvis_z: 0.78, tilt_deg: 5 }, {})).toBeCloseTo(0.28, 12);
    expect(stayUpright.margin({ pelvis_z: 0.4, tilt_deg: 60 }, {})).toBeCloseTo(-0.1, 12);
  });

  it('forces -0.01 m for stay upright when the tilt exceeds 60 deg', () => {
    expect(stayUpright.margin({ pelvis_z: 0.9, tilt_deg: 61 }, {})).toBe(-0.01);
  });

  it('gives pelvis_z minus the length for keep its pelvis above', () => {
    expect(pelvisAbove.margin({ pelvis_z: 0.7 }, { length: 0.6 })).toBeCloseTo(0.1, 12);
  });

  it('gives the speed slot minus the speed error after settling', () => {
    expect(trackSpeed.margin({ forward_speed: 0.42, commanded_speed: 0.5, episode_time: 3 }, { speed: 0.15 })).toBeCloseTo(0.07, 12);
  });

  it('forgives the speed error while the episode time is under 2 s', () => {
    expect(trackSpeed.margin({ forward_speed: 0, commanded_speed: 0.5, episode_time: 1.99 }, { speed: 0.15 })).toBe(0.15);
  });

  it('gives the length minus the drift for not drift sideways more than', () => {
    expect(noSideDrift.margin({ lateral_drift: 0.12 }, { length: 0.3 })).toBeCloseTo(0.18, 12);
  });
});
