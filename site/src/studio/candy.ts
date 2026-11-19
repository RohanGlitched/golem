// The candy studio: Franka Panda with a suction cup near trick-or-treaters' hands, the lines of candy-sorter/requirements.md.
import app, { setRobotBase } from '@app/candy';
import requirements from '@spec/candy?raw';
import appWorker from './candy-worker.ts?worker&url';
import './fetch-shim';
import { mountSiteStudio } from './common';
import type { StudioHandle } from 'golem-spec/ui';

setRobotBase(new URL('/candy/robot/', location.href));

export function mount(el: HTMLElement): StudioHandle {
  return mountSiteStudio({ el, app, requirements, workerUrl: new URL(appWorker, location.href).href, entryUrl: new URL(appWorker, location.href).href });
}
