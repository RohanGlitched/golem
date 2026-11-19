// The words GOLEM's EARS compiler matches for the G1: robot names, predicates and perturbations.
import type { Lexicon } from './contract.js';
import { predicates } from './predicates.js';
import { perturbations } from './perturbations.js';

export const lexicon: Lexicon = {
  robotNames: ['golem', 'G1', 'robot'],
  predicates,
  perturbations,
};
