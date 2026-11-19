// The module the demo's trial workers import: the app and a resolver for the lines the studio sends.
import { studioRequirements } from '../src/ui/worker.js';
import { demoApp } from './demo-app.js';

export const app = demoApp;
export const requirements = studioRequirements(demoApp);
