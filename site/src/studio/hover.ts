// The hover studio: Skydio X2 holding a point in gusts, the lines of hover-hold/requirements.md.
import app, { setRobotBase } from '@app/hover';
import requirements from '@spec/hover?raw';
import appWorker from './hover-worker.ts?worker&url';
import './fetch-shim';
import { mountSiteStudio } from './common';
import type { StudioHandle } from 'golem-spec/ui';

setRobotBase(new URL('/hover/robot/', location.href));

// the same options as apps/hover/web/main.ts: a shove is a gust on the whole drone
const STUDIO_OPTIONS = {
  primaryPushBody: 'x2',
  tiltWords: ['tilt'],
  signalWords: { hover_distance: ['within'], altitude: ['above'], tilt_deg: ['tilt'] },
}

export function mount(el: HTMLElement): StudioHandle {
  return mountSiteStudio({ el, app, requirements, workerUrl: new URL(appWorker, location.href).href, entryUrl: new URL(appWorker, location.href).href, options: STUDIO_OPTIONS });
}