// The yard studio: any yard robot (apps/yard/robots.json) standing on its servos, with the shared stand-push lines.
// The page names its robot in data-robot; the trial workers read it from their own URL (?robot=<id>).
import { standApp } from '@app/yard-stand';
import requirements from '@spec/yard?raw';
import appWorker from './yard-worker.ts?worker&url';
import './fetch-shim';
import { mountSiteStudio } from './common';
import yardSeeds from 'virtual:golem-seeds/yard';
import type { StudioHandle } from 'golem-spec/ui';

export function mount(el: HTMLElement): StudioHandle {
  const id = el.dataset['robot'] ?? 'go1';
  const app = standApp(id, new URL(`/yard/${id}/robot/`, location.href));
  const worker = new URL(appWorker, location.href);
  worker.searchParams.set('robot', id);
  return mountSiteStudio({
    el, app, requirements, workerUrl: worker.href, entryUrl: worker.href,
    options: {
      // a shove pushes the base, as the requirements do
      primaryPushBody: app.robot.base,
      shippedSeeds: yardSeeds[id] ?? [],
      signalWords: { base_height_ratio: ['upright'], tilt_deg: ['upright'], drift: ['move'] },
    },
  });
}
