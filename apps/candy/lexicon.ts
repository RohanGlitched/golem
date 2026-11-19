// The words GOLEM's EARS compiler matches for the candy sorter: robot names, predicates and perturbations.
//
// "from any direction" in this app means the DOORSTEP HALF. Trick-or-treaters stand on the doorstep side of the Table,
// beyond the edge that faces away from the Panda base, so a hand enters only through that edge, across an arc of about
// 120 degrees (-60 to +60 degrees about straight out from the base), and reaches toward the bowl nearest its entry
// point at 0.05 m to 0.25 m above the Table. It never passes the base column. The compiler gives `from any direction`
// the range [0, 360) degrees for hand.angle; this app reads that value as a position across the doorstep arc, not as a
// compass bearing: 0 deg is the -60 deg end (orange bowl), 90 deg is straight on (purple bowl), 180 deg is the +60 deg
// end (green bowl), and 360 deg is the -60 deg end again, so a wrapping search sees no jump. See `doorstepAzimuth` in
// geometry.ts and the Glossary of .kiro/specs/candy-sorter/requirements.md. `from behind` has no meaning here (nobody
// stands behind the base): any written angle is folded onto the same arc.
import type { Lexicon } from './contract';
import { perturbations } from './perturbations';
import { predicates } from './predicates';

export const lexicon: Lexicon = {
  robotNames: ['arm', 'Panda', 'robot'],
  predicates,
  perturbations,
};
