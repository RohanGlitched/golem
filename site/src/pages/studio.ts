// The two app studios, /stagger/ and /candy/. When an app is not in the checkout the page says so instead of failing the build.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../build/data';
import type { PageSpec } from '../build/layout';

const INFO = {
  stagger: {
    title: 'Stagger studio',
    robot: 'Unitree G1',
    description: 'Shove a simulated Unitree G1 walking under Unitree’s published policy, then summon 64 ghosts to find the push that breaks it.',
    intro: 'The G1 walks under Unitree’s published policy. Drag a number in a sentence, shove the robot, or summon ghosts to test the sentence.',
  },
  candy: {
    title: 'Candy studio',
    robot: 'Franka Panda',
    description: 'A Franka Panda with a suction cup sorts Halloween candy while a simulated hand reaches in. Test the speed-and-separation requirements.',
    intro: 'A Franka Panda sorts candy into three bowls while a hand reaches in from the doorstep side. Summon ghosts to test the safety lines.',
  },
} as const;

export function appPresent(id: 'stagger' | 'candy', root: string = REPO_ROOT): boolean {
  return existsSync(path.join(root, 'apps', id, 'app.ts')) && existsSync(path.join(root, 'apps', id, 'robot', 'SOURCE.json'));
}

export function studioPage(id: 'stagger' | 'candy'): PageSpec {
  const i = INFO[id];
  const present = appPresent(id);
  const body = present
    ? `<div class="flush studio-page"><div class="hero-studio" id="studio" data-studio="${id}" data-status="Waking the golem…"><noscript><p class="hero-fallback">The studio needs JavaScript. The measured results do not: <a href="/evidence/">open the evidence</a>.</p></noscript></div><p class="studio-note">${i.intro} <a href="/">Back to the home page</a>. <a href="/evidence/">Measured results</a>.</p></div>`
    : `<h1>${i.title}</h1><p class="lede">The ${i.robot} studio is not built in this checkout.</p><p>Its app files are missing from <code>apps/${id}/</code>, so this build ships no studio and no robot files for it. The studio appears here when the app is added and the site is rebuilt. Nothing else on the site depends on it.</p><p><a href="/">Back to the home page</a>.</p>`;
  return { id, path: `/${id}/`, title: i.title, description: i.description, body, modules: present ? ['/src/studio/load.ts'] : [], mainClass: present ? 'studio-main' : undefined };
}
