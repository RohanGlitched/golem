// The module the studio's trial workers import: the app and a resolver for the lines the studio sends.
import { studioRequirements } from 'golem-spec/ui/worker';
import { hover, setRobotBase } from '../app';

setRobotBase(new URL('../robot/', import.meta.url));

export const app = hover;
export const requirements = studioRequirements(hover);
