import { readFileSync } from 'node:fs';
import { compileRequirement } from 'golem-spec';
import { describe, expect, it } from 'vitest';
import { lexicon } from '../lexicon';
import { allocations, functionBody } from './helpers/sourceScan';

const dimsOf = (line: string) => {
  const r = compileRequirement(line, lexicon);
  expect(r.diagnostics).toEqual([]);
  return r.requirement!;
};

describe('lexicon structure', () => {
  it('names the robot golem, G1 or robot', () => {
    expect(lexicon.robotNames).toEqual(['golem', 'G1', 'robot']);
  });

  it('declares the six perturbation phrases', () => {
    expect(lexicon.perturbations.map((p) => p.phrase)).toEqual([
      'the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}',
      'walking on a slope of {range:angle}',
      'carrying a payload of {range:mass}',
      'the floor friction drops to {ratio}',
      'the sensor latency rises to {range:duration}',
      'commanded to walk at {range:speed}',
    ]);
  });

  it('turns a push line into push.force, push.angle and push.phase with a fixed duration', () => {
    const req = dimsOf('R1. WHEN the pelvis is pushed with up to 100 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s');
    expect(req.space.dims).toEqual([
      { name: 'push.force', kind: 'force', min: 0, max: 100, severity: 'up' },
      { name: 'push.angle', kind: 'angle', min: 0, max: 2 * Math.PI, severity: 'none', wrap: true },
      { name: 'push.phase', kind: 'phase', min: 0, max: 1, severity: 'none', wrap: true },
    ]);
    expect(req.perturbations[0]!.params).toMatchObject({ force: 'push.force', duration: 0.2, phase: 'push.phase' });
  });

  it('reads from behind as 135 deg to 225 deg', () => {
    const req = dimsOf('WHEN the pelvis is pushed with up to 250 N for 0.2 s from behind at any point in its stride THE G1 SHALL stay upright for 3 s');
    expect(req.space.dims[1]).toEqual({ name: 'push.angle', kind: 'angle', min: (3 * Math.PI) / 4, max: (5 * Math.PI) / 4, severity: 'none', wrap: true });
  });

  it('passes a fixed push direction to apply', () => {
    const req = dimsOf('WHEN the pelvis is pushed with up to 100 N for 0.2 s from 90 deg at any point in its stride THE robot SHALL stay upright for 3 s');
    expect(req.perturbations[0]!.params['direction']).toBeCloseTo(Math.PI / 2, 12);
  });

  // blocked-on-ears: compile.ts maps a slot to a Dimension only by name (`direction` or `*.direction`),
  // so the searched `push.angle` of `{direction}` never reaches apply. Expected to pass once ears maps it.
  it.fails('wires a searched push.angle into the push parameters', () => {
    const req = dimsOf('WHEN the pelvis is pushed with up to 100 N for 0.2 s from any direction at any point in its stride THE robot SHALL stay upright for 3 s');
    expect(Object.values(req.perturbations[0]!.params)).toContain('push.angle');
  });

  it('declares slope, payload, latency and command dimensions', () => {
    expect(dimsOf('WHEN walking on a slope of up to 10 deg THE robot SHALL stay upright for 5 s').space.dims)
      .toEqual([{ name: 'slope.angle', kind: 'angle', min: 0, max: (10 * Math.PI) / 180, severity: 'up' }]);
    expect(dimsOf('WHEN carrying a payload of up to 5 kg THE robot SHALL stay upright for 5 s').space.dims)
      .toEqual([{ name: 'payload.mass', kind: 'mass', min: 0, max: 5, severity: 'up' }]);
    expect(dimsOf('WHEN the sensor latency rises to up to 40 ms THE robot SHALL stay upright for 5 s').space.dims)
      .toEqual([{ name: 'latency.duration', kind: 'duration', min: 0, max: 0.04, severity: 'up' }]);
    expect(dimsOf('WHEN commanded to walk at 0.3 to 0.8 m/s THE robot SHALL track the commanded speed within 0.2 m/s for 5 s').space.dims)
      .toEqual([{ name: 'command.speed', kind: 'speed', min: 0.3, max: 0.8, severity: 'none' }]);
  });

  it('keeps the friction ratio fixed', () => {
    const req = dimsOf('WHEN the floor friction drops to 30% THE robot SHALL stay upright for 5 s');
    expect(req.space.dims).toEqual([]);
    expect(req.perturbations[0]!.params['ratio']).toBeCloseTo(0.3, 12);
  });

  it('rejects a friction ratio above 100% naming the ratio and the range', () => {
    let message = '';
    try {
      const r = compileRequirement('WHEN the floor friction drops to 130% THE robot SHALL stay upright for 5 s', lexicon);
      message = r.diagnostics.map((x) => x.message).join('\n');
    } catch (e) { message = (e as Error).message; }
    expect(message).toContain('ratio 130% is outside 0% to 100%');
  });

  it('allocates nothing inside any apply', () => {
    for (const name of ['push', 'slope', 'payload', 'friction', 'latency', 'command']) {
      const body = functionBody('perturbations.ts', new RegExp(`export const ${name}: PerturbationTemplate = \\{[\\s\\S]*?apply\\(`));
      expect([name, allocations(body)]).toEqual([name, []]);
    }
  });

  it('uses no Math.random in the lexicon sources', () => {
    for (const f of ['lexicon.ts', 'predicates.ts', 'perturbations.ts', 'signals.ts', 'runtime.ts']) {
      expect([f, /Math\.random/.test(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))]).toEqual([f, false]);
    }
  });
});
