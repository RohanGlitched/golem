// The G1 studio: Unitree G1 under Unitree's walking policy, the 11 lines of g1-walking/requirements.md.
import app, { setRobotBase } from '@app/stagger';
import requirements from '@spec/stagger?raw';
import appWorker from './stagger-worker.ts?worker&url';
import './fetch-shim';
import { mountSiteStudio } from './common';
import type { StudioHandle } from 'golem-spec/ui';

setRobotBase(new URL('/stagger/robot/', location.href));

export function mount(el: HTMLElement): StudioHandle {
  return mountSiteStudio({ el, app, requirements, workerUrl: new URL(appWorker, location.href).href, entryUrl: new URL(appWorker, location.href).href });
}
