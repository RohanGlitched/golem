// Preview page: the studio on the real Unitree G1 app (apps/stagger), robot files served from ./robot/.
import { mountStudio } from '../src/ui/index.js';
import { InlinePool } from '../src/ui/run/inline-pool.js';
import stagger, { setRobotBase } from '../../apps/stagger/app.js';
import md from '../../apps/stagger/.kiro/specs/g1-walking/requirements.md?raw';

setRobotBase(new URL('./robot/', location.href));
const params = new URLSearchParams(location.search);
const el = document.getElementById('app') as HTMLElement;
const studio = mountStudio(el, stagger, md, {
  ...(params.get('inline') === '1'
    ? { pool: new InlinePool(stagger) }
    : {
      workerUrl: new URL('./g1-worker.ts', import.meta.url),
      workerEntry: new URL('../src/pool/browser-entry.ts', import.meta.url),
      ...(params.has('workers') ? { workerCount: Number(params.get('workers')) } : {}),
    }),
  seed: Number(params.get('seed') ?? 1),
  budget: { maxTrials: Number(params.get('trials') ?? 64), maxMs: 60000 },
  autorun: params.get('autorun') === '1',
  idleSleepMs: Number(params.get('sleep') ?? 10000),
  fontBaseUrl: './fonts/',
  // The G1's head is drawn as part of the pelvis body (g1_12dof has no head link).
  emet: { body: 'pelvis' },
  // summonSynthetic(n, seconds): synthetic ghosts for the fps probe and the bullet-time and scrubber checks.
  testHooks: { summonSynthetic: true },
});
Object.assign(window, { studio });
