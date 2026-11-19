// The trial workers' script for the stagger studio: the app is imported here and served by serveStudioWorker,
// because Vite builds a `?worker&url` file as a standalone entry and drops its exports (the default pool entry
// would import this file and find no `app`).
import app, { setRobotBase } from '@app/stagger';
import './fetch-shim';
import { serveStudioWorker } from 'golem-spec/ui/worker';

setRobotBase(new URL('/stagger/robot/', self.location.href));
serveStudioWorker(app);
