// Public entry of golem-spec/ui. Everything else under src/ui is internal.
import type { RobotApp, StudioHandle, StudioOptions } from './types.js';

export type { StudioOptions, StudioHandle, PerturbationVisual } from './types.js';

export function mountStudio(
  _el: HTMLElement, _app: RobotApp, _requirementsMarkdown: string, _options?: StudioOptions,
): StudioHandle {
  throw new Error('mountStudio is not implemented yet');
}
