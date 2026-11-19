// The candy studio page: GOLEM's studio on the Panda, with the requirements of apps/candy/.kiro/specs/candy-sorter.
// Robot files come from /robot/ (served from apps/candy/robot by vite.config.ts). The hand is a mocap body: the pointer
// carries it, within the rules of `constrainDraggedHand`. Trials run in Web Workers, or on this page with ?inline=1
// and wherever Workers are unavailable.
//
// Query parameters: ?autorun=1 tests every line on load; ?trials=N sets the budget (default 48); ?seed=N; ?workers=N.
import { mountStudio } from 'golem-spec/ui';
import md from '../.kiro/specs/candy-sorter/requirements.md?raw';
import { candy, setRobotBase } from '../app';
import { constrainDraggedHand } from '../geometry';

setRobotBase(new URL('robot/', document.baseURI));
const params = new URLSearchParams(location.search);
const el = document.getElementById('app') as HTMLElement;

const studio = mountStudio(el, candy, md, {
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
  // the arm is the thing to push; the hand is the thing to drag
  primaryPushBody: 'link7',
  dragBody: { body: 'hand', noun: 'hand', constrain: constrainDraggedHand },
});

Object.assign(window, { studio });
