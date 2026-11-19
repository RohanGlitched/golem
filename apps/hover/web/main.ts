// The hover studio page: GOLEM's studio on the Skydio X2, with the requirements of apps/hover/.kiro/specs/hover-hold.
// Robot files come from /robot/ (served from apps/hover/robot by vite.config.ts). Trials run in Web Workers, or on this
// page with ?inline=1 and wherever Workers are unavailable.
//
// Query parameters: ?autorun=1 tests every line on load; ?trials=N sets the budget (default 48); ?seed=N; ?workers=N.
import { mountStudio } from 'golem-spec/ui';
import md from '../.kiro/specs/hover-hold/requirements.md?raw';
import { hover, setRobotBase } from '../app';

setRobotBase(new URL('robot/', document.baseURI));
const params = new URLSearchParams(location.search);
const el = document.getElementById('app') as HTMLElement;

const studio = mountStudio(el, hover, md, {
  ...(params.get('inline') === '1'
    ? {}
    : {
      workerUrl: new URL('./worker.ts', import.meta.url),
      ...(params.has('workers') ? { workerCount: Number(params.get('workers')) } : {}),
    }),
  seed: Number(params.get('seed') ?? 1),
  budget: { maxTrials: Number(params.get('trials') ?? 48), maxMs: 120000 },
  autorun: params.get('autorun') === '1',
  idleSleepMs: Number(params.get('sleep') ?? 20000),
  // a shove is a gust: it pushes the whole drone, at its centre
  primaryPushBody: 'x2',
  // the word "tilt" leans with the drone, and a broken line fractures at the word of the signal that broke
  tiltWords: ['tilt'],
  signalWords: { hover_distance: ['within'], altitude: ['above'], tilt_deg: ['tilt'] },
});

Object.assign(window, { studio });
