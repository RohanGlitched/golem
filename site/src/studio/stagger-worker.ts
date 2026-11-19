// The trial workers' script for the stagger studio: the app is imported here and served by serveStudioWorker,
// because Vite builds a `?worker&url` file as a standalone entry and drops its exports (the default pool entry
// would import this file and find no `app`).
// Each worker also follows the page's controller choice (Unitree's policy, or + Kiro's reflex), so ghosts run what the page shows.
import app, { setReflex, setRobotBase } from '@app/stagger';
import './fetch-shim';
import { serveStudioWorker } from 'golem-spec/ui/worker';
import { CONTROLLER_CHANNEL, followControllerChoice } from './stagger-controller';

setRobotBase(new URL('/stagger/robot/', self.location.href));
if (typeof BroadcastChannel !== 'undefined') followControllerChoice(new BroadcastChannel(CONTROLLER_CHANNEL), setReflex);
serveStudioWorker(app);
