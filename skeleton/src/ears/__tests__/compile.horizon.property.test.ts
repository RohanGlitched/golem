import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import { compileRequirement } from '../compile.js';
import type { Dimension, Lexicon, PerturbationTemplate, PredicateTemplate } from '../types.js';
import { propConfig } from './support.js';

const forceDim = (s: Record<string, unknown>): Dimension[] => {
  const f = s['force'] as [{ si: number }, { si: number }];
  return [{ name: 'push.force', kind: 'force', min: f[0].si, max: f[1].si, severity: 'up' }];
};
const withDuration: PerturbationTemplate = {
  phrase: 'the pelvis is pushed with {range:force} for {duration}',
  dims: forceDim,
  apply: () => {},
};
const noDuration: PerturbationTemplate = {
  phrase: 'the pelvis is nudged with {range:force}',
  dims: forceDim,
  apply: () => {},
};
const upright: PredicateTemplate = {
  phrase: 'stay upright', signals: ['h'], unit: 'm', margin: (s) => s['h']! - 0.5,
};
const lexicon = (extra: Partial<Lexicon> = {}): Lexicon => ({
  robotNames: ['robot'], predicates: [upright], perturbations: [withDuration, noDuration], ...extra,
});

// Whole milliseconds keep the written text exact; SI values are ms / 1000.
const arbMs = fc.integer({ min: 1, max: 20000 });
const arbWrapper = fc.constantFrom('for', 'within');
const arbEvent = fc.constantFrom('event', 'unwanted');
const text = (pattern: string, trigger: string, resp: string): string =>
  pattern === 'event'
    ? `WHEN ${trigger} THE robot SHALL ${resp}`
    : `IF ${trigger} THEN THE robot SHALL ${resp}`;

const closeTo = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

/**
 * Horizon rules (golem-ears-hardening defect 4): `for d` needs d after the trigger plus the trigger's
 * own duration; `within T` (F then G) needs the deadline T plus at least T of hold.
 */
const eventHorizon = (wrap: string, w: number, d: number): number => (wrap === 'for' ? w + d : 2 * w + d);

describe('compileRequirement horizon', () => {
  // Feature: golem-ears, Property 26: Horizon follows the wrapper and trigger durations
  it('sets horizon to wrapper plus trigger duration for event and unwanted requirements', () => {
    // **Validates: Requirements 6.9**
    fc.assert(
      fc.property(arbEvent, arbWrapper, arbMs, arbMs, (pattern, wrap, wMs, dMs) => {
        const line = text(
          pattern,
          `the pelvis is pushed with up to 200 N for ${dMs} ms`,
          `stay upright ${wrap} ${wMs} ms`,
        );
        const r = compileRequirement(line, lexicon());
        return r.requirement !== undefined && closeTo(r.requirement.horizon, eventHorizon(wrap, wMs / 1000, dMs / 1000));
      }),
      propConfig,
    );
  });

  // Feature: golem-ears, Property 26: Horizon follows the wrapper and trigger durations
  it('sets horizon to the wrapper duration alone when the trigger has no duration', () => {
    // **Validates: Requirements 6.9**
    fc.assert(
      fc.property(arbEvent, arbWrapper, arbMs, (pattern, wrap, wMs) => {
        const line = text(pattern, 'the pelvis is nudged with up to 200 N', `stay upright ${wrap} ${wMs} ms`);
        const r = compileRequirement(line, lexicon());
        return r.requirement !== undefined && closeTo(r.requirement.horizon, eventHorizon(wrap, wMs / 1000, 0));
      }),
      propConfig,
    );
  });

  // Feature: golem-ears, Property 26: Horizon follows the wrapper and trigger durations
  it('uses the episode length for ubiquitous requirements, extended to 2T for within T', () => {
    // **Validates: Requirements 6.9**
    fc.assert(
      fc.property(
        arbWrapper, arbMs, fc.option(fc.integer({ min: 1, max: 600 }), { nil: undefined }),
        fc.option(fc.integer({ min: 1, max: 600 }), { nil: undefined }),
        (wrap, wMs, optEp, lexEp) => {
          const lex = lexicon(lexEp !== undefined ? { episodeSeconds: lexEp } : {});
          const r = compileRequirement(
            `THE robot SHALL stay upright ${wrap} ${wMs} ms`, lex,
            optEp !== undefined ? { episodeSeconds: optEp } : {},
          );
          const episode = optEp ?? lexEp ?? 10;
          const want = wrap === 'within' ? Math.max(episode, (2 * wMs) / 1000) : episode;
          return r.requirement !== undefined && closeTo(r.requirement.horizon, want);
        },
      ),
      propConfig,
    );
  });
});
