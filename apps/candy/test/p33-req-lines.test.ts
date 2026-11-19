// Feature: candy-app, Property 33: Every requirement line compiles
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { compileRequirement, extractCriteria } from 'golem-spec';
import { describe, expect, it } from 'vitest';
import { lexicon } from '../lexicon';

const text = readFileSync(new URL('../.kiro/specs/candy-sorter/requirements.md', import.meta.url), 'utf8');
const criteria = extractCriteria(text).criteria;

const THEMES: Record<string, RegExp> = {
  'separation distance from the hand': /keep every link at least [\d.]+ m from the hand/,
  'fastest link speed near the hand': /a hand reaches in .* keep its fastest link below/,
  'table contact force': /never press on the table with more than/,
  'candies dropped outside the bowls': /not drop a candy outside the bowls/,
  'sorting success': /drop every candy into the bowl of its colour within/,
  'tolerance to heavier candies': /the candies weigh .* drop every candy/,
  'tolerance to weaker vacuum': /the vacuum weakens to .* drop every candy/,
  'tolerance to a lagging hand tracker': /the hand tracker lags by/,
};

describe('requirement lines', () => {
  it('compiles every acceptance criterion with no diagnostic, to a requirement whose id is the criterion id', () => {
    fc.assert(fc.property(fc.constantFrom(...criteria), (c) => {
      const r = compileRequirement(c.text, lexicon, { id: c.id });
      expect(r.diagnostics).toEqual([]);
      expect(r.requirement).toBeDefined();
      expect(r.requirement!.id).toBe(c.id);
      expect(r.requirement!.horizon).toBeGreaterThan(0);
      expect(Number.isFinite(r.requirement!.horizon)).toBe(true);
    }), { numRuns: 100 });
  });

  it('has at least one line for each of the eight themes', () => {
    for (const [theme, re] of Object.entries(THEMES)) {
      expect(criteria.some((c) => re.test(c.text)), theme).toBe(true);
    }
  });

  it('pairs the separation predicate with the hand perturbation, and the sorting predicate with candies landing on the tray', () => {
    expect(criteria.some((c) => /a hand reaches in .* keep every link at least/.test(c.text))).toBe(true);
    expect(criteria.some((c) => /candies land anywhere on the tray .* drop every candy into the bowl of its colour/.test(c.text))).toBe(true);
  });

  it('turns the trigger ranges into the scenario space: 1.5 m/s hand, 0.005 to 0.060 kg, 50% to 100%, 0.3 s lag', () => {
    const dims = (id: string) => compileRequirement(criteria.find((c) => c.id === id)!.text, lexicon).requirement!.space.dims;
    expect(dims('1.1').find((d) => d.name === 'hand.speed')).toMatchObject({ min: 0, max: 1.5, severity: 'up' });
    expect(dims('1.1').find((d) => d.name === 'hand.angle')).toMatchObject({ wrap: true, min: 0, max: 2 * Math.PI });
    expect(dims('6.1')[0]).toMatchObject({ name: 'candy.mass', min: 0.005, max: 0.06, severity: 'up' });
    expect(dims('7.1')[0]).toMatchObject({ name: 'vacuum.ratio', min: 0.5, max: 1, severity: 'down' });
    expect(dims('8.1').find((d) => d.name === 'tracker.lag')).toMatchObject({ min: 0, max: 0.3, severity: 'up' });
    expect(dims('5.1')).toHaveLength(12);
  });

  // golem-ears-hardening (defect 11): an event line with within T is monitored to onset + trigger + 2T, so the hold after the deadline is seen.
  it('gives the sorting lines a 90 s horizon (2 x 45 s) and the hand lines the default episode', () => {
    const h = (id: string) => compileRequirement(criteria.find((c) => c.id === id)!.text, lexicon).requirement!.horizon;
    for (const id of ['5.1', '6.1', '7.1']) expect(h(id)).toBe(90);
    for (const id of ['1.1', '2.1', '8.1']) expect(h(id)).toBe(10);
  });
});
