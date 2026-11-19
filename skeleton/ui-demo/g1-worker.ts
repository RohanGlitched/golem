// The module the G1 page's trial workers import: the Stagger app (robot files from this origin's /robot/)
// and a resolver for the lines the studio sends.
import { studioRequirements } from '../src/ui/worker.js';
import stagger, { setRobotBase } from '../../apps/stagger/app.js';

setRobotBase(new URL('/robot/', self.location.href));
export const app = stagger;
export const requirements = studioRequirements(stagger);
