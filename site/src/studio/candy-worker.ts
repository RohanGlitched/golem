// The module the candy trial workers import: the app and a resolver for the lines the studio sends.
import app, { setRobotBase } from '@app/candy';
import './fetch-shim';
import { studioRequirements } from 'golem-spec/ui/worker';

setRobotBase(new URL('/candy/robot/', self.location.href));
// Prefetch the robot files as soon as the worker starts, so the first summon doesn't wait on the network.
void app.files().catch(() => { /* the first trial reports the real error */ });

export { app };
export const requirements = studioRequirements(app);
