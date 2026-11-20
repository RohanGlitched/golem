// The G1 studio: Unitree G1 under Unitree's walking policy, the 11 lines of g1-walking/requirements.md.
// A control above the stage switches the controller to Unitree's policy + Kiro's reflex, on the page thread (the live
// robot) and in every trial worker (the ghosts); the default is Unitree's policy alone.
import app, { setReflex, setRobotBase } from '@app/stagger';
import requirements from '@spec/stagger?raw';
import appWorker from './stagger-worker.ts?worker&url';
import './fetch-shim';
import { mountSiteStudio } from './common';
import shippedSeeds from 'virtual:golem-seeds/stagger';
import { mountControllerBar } from './controller-bar';
import { CONTROLLER_CHANNEL, hostControllerChoice } from './stagger-controller';
import type { StudioHandle } from 'golem-spec/ui';

setRobotBase(new URL('/stagger/robot/', location.href));

/** Restarts the live robot through the studio's own button, so it is rebuilt under the controller just chosen. */
function resetLiveRobot(el: HTMLElement): void {
  const reset = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => /reset the robot/i.test(b.textContent ?? ''));
  if (reset && !reset.disabled) reset.click();
}

export function mount(el: HTMLElement): StudioHandle {
  const handle = mountSiteStudio({ el, app, requirements, workerUrl: new URL(appWorker, location.href).href, entryUrl: new URL(appWorker, location.href).href, options: { shippedSeeds } });
  // Without BroadcastChannel the workers could not follow the choice, so the control is not offered.
  if (typeof BroadcastChannel === 'undefined') return handle;
  const choice = hostControllerChoice(new BroadcastChannel(CONTROLLER_CHANNEL), setReflex);
  const removeBar = mountControllerBar(el, choice, () => resetLiveRobot(el));
  return {
    ready: handle.ready,
    getState: () => handle.getState(),
    dispose: () => { removeBar(); choice.close(); handle.dispose(); },
  };
}
