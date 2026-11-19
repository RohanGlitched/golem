import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatMargin, formatQuantity, gateBlock, requirementLine } from '../format.js';
import { makeOutcome } from '../../../test/support/outcomes.js';
import { propConfig } from '../../../test/support/prop.js';

const force = fc.double({ min: 0, max: 400, noNaN: true });
const rob = fc.double({ min: -5, max: 5, noNaN: true });

describe('Property 24: printed lines carry units and ids', () => {
  // Feature: golem-kit, Property 24: Printed lines carry units and ids
  it('a broken line has id, status, trial count and unit-bearing scenario values', () => {
    fc.assert(fc.property(force, rob, fc.integer({ min: 1, max: 2000 }), fc.nat(), (f, r, trials, seed) => {
      const line = requirementLine(makeOutcome({ status: 'broken', force: f, robustness: -Math.abs(r) - 0.001, trials, seed }));
      expect(line).toContain('1.2');
      expect(line).toContain('BROKEN');
      expect(line).toContain(`${trials} trials`);
      expect(line).toContain(`push.force = ${formatQuantity('force', f)}`);
      expect(line).toMatch(/push\.force = \S+ N/);
      expect(line).toContain(`seed ${seed}`);
    }), propConfig);
  });

  it('a held line holds the exact phrase with the real trial count', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100000 }), (trials) => {
      expect(requirementLine(makeOutcome({ status: 'held', trials }))).toContain(`no counterexample in ${trials} trials`);
    }), propConfig);
  });

  it('a gate block has the EARS line, the scenario with units, the margin with unit and the replay command', () => {
    fc.assert(fc.property(force, rob, fc.string({ minLength: 1, maxLength: 40 }).map((s) => s.replace(/[\r\n]/g, ' ')), (f, r, ears) => {
      const rr = -Math.abs(r) - 0.001;
      const b = gateBlock(makeOutcome({ status: 'broken', force: f, robustness: rr }), ears);
      expect(b).toContain(ears);
      expect(b).toContain(`push.force = ${formatQuantity('force', f)}`);
      expect(b).toContain(`margin: ${formatMargin(rr, 'm')}`);
      expect(b).toMatch(/margin: -[\d.e-]+ m/);
      expect(b).toContain('npx golem-spec replay 1.2');
    }), propConfig);
  });
});
