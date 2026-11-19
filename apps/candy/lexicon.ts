// The words GOLEM's EARS compiler matches for the candy sorter: robot names, predicates and perturbations.
import type { Lexicon } from './contract';
import { perturbations } from './perturbations';
import { predicates } from './predicates';

export const lexicon: Lexicon = {
  robotNames: ['arm', 'Panda', 'robot'],
  predicates,
  perturbations,
};
