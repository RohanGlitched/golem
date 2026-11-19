// Mounts one studio through the public entry points of the skeleton (golem-spec/ui). Loaded only on `/` and on the app pages.
import { mountStudio } from 'golem-spec/ui';
import type { StudioHandle } from 'golem-spec/ui';
import { readTheme } from '../client/theme';

export type StudioApp = Parameters<typeof mountStudio>[1];

export interface MountArgs {
  el: HTMLElement;
  app: StudioApp;
  requirements: string;
  /** Built URL of the module that exports `app` and `requirements` for the trial workers. */
  workerUrl: string;
  /** Built URL of the pool's worker script. */
  entryUrl: string;
  trials?: number;
  /** App-specific studio options, such as the body a shove pushes. */
  options?: NonNullable<Parameters<typeof mountStudio>[3]>;
}

/** Clicks the studio's own theme button when its theme differs from the page's, so both always agree. */
function syncTheme(root: HTMLElement): void {
  const want = readTheme();
  const studio = root.querySelector<HTMLElement>('.golem-studio');
  const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.golem-btn[aria-pressed]')).find((b) => /theme/i.test(b.textContent ?? ''));
  if (!studio || !btn) return;
  const has = studio.getAttribute('data-golem-theme') === 'light' ? 'light' : 'dark';
  if (has !== want) btn.click();
}

export function mountSiteStudio(a: MountArgs): StudioHandle {
  const handle = mountStudio(a.el, a.app, a.requirements, {
    workerUrl: a.workerUrl,
    workerEntry: a.entryUrl,
    seed: 1,
    budget: { maxTrials: a.trials ?? 96, maxMs: 45000 },
    theme: readTheme(),
    fontBaseUrl: '/fonts/',
    idleSleepMs: 10000,
    ...a.options,
  });
  const sync = (): void => syncTheme(a.el);
  document.addEventListener('golem-theme', sync);
  void handle.ready.then(sync, () => { /* the studio shows its own error */ });
  // The studio can change the theme too (its own button): keep the page in step.
  const studio = (): HTMLElement | null => a.el.querySelector<HTMLElement>('.golem-studio');
  new MutationObserver(() => {
    const t = studio()?.getAttribute('data-golem-theme');
    if ((t === 'light' || t === 'dark') && t !== readTheme()) {
      document.documentElement.setAttribute('data-theme', t);
      document.querySelectorAll('[data-theme-toggle]').forEach((b) => { b.textContent = t === 'light' ? 'Dark' : 'Light'; });
    }
  }).observe(a.el, { attributes: true, subtree: true, attributeFilter: ['data-golem-theme'] });
  return handle;
}
