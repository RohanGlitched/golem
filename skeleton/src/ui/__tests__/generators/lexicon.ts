// A lexicon on top of the golem-sim Test_App push template, with predicates over its signals.
import { testApp } from '../../../sim/index.js';
import type { PredicateTemplate } from '../../../ears/index.js';
import type { Lexicon, RobotApp } from '../../types.js';

export const keepBob: PredicateTemplate = {
  phrase: 'keep the bob within {angle}',
  signals: ['bob.angle'],
  unit: 'rad',
  margin: (s, slots) => (slots['angle'] as number) - Math.abs(s['bob.angle'] as number),
};
export const keepBox: PredicateTemplate = {
  phrase: 'keep the box above {length}',
  signals: ['box.z'],
  unit: 'm',
  margin: (s, slots) => (s['box.z'] as number) - (slots['length'] as number),
};

export const testLexicon: Lexicon = {
  ...testApp.lexicon,
  robotNames: ['robot', 'golem'],
  predicates: [keepBob, keepBox],
};

export const lexApp: RobotApp = { ...testApp, lexicon: testLexicon as RobotApp['lexicon'] };

export const GOOD_LINE = 'WHEN the bob is pushed with up to 20 N for 0.2 s from any direction THE robot SHALL keep the bob within 0.3 rad';
