// The words GOLEM's EARS compiler matches for the hover app: robot names, predicates and perturbations.
//
// "from any direction" means every compass direction: the compiler gives it the range [0, 360) degrees for
// gust.angle, counterclockwise from +x, and the gust pushes away from that side (see GUST_SLOTS in perturbations.ts).
import { EPISODE_SECONDS } from './constants';
import type { Lexicon } from './contract';
import { perturbations } from './perturbations';
import { predicates } from './predicates';

export const lexicon: Lexicon = {
  robotNames: ['drone', 'quadrotor', 'X2', 'robot'],
  predicates,
  perturbations,
  episodeSeconds: EPISODE_SECONDS,
};
