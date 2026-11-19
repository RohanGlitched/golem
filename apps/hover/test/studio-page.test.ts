// The studio page: wiring in apps/hover/web and in the site, and the scene the stage draws.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const repo = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const html = read('web/index.html');
const main = read('web/main.ts');
const worker = read('web/worker.ts');
const vite = read('web/vite.config.ts');

describe('studio page: copy', () => {
  it('says which two lines are expected to break, and that a held line is not a proof', () => {
    expect(html).toContain('Line 1.3');
    expect(html).toContain('Line 3.2');
    expect(html).toContain('not a proof');
  });
  it('states every distance, force and time with its unit', () => {
    for (const q of ['1.0 m', '20 N', '10 N', '35 degrees', '0.30 s', '0.27 s']) expect(html, q).toContain(q);
  });
});

describe('studio page: wiring', () => {
  it('mounts the studio on the hover app with the requirements file of this app', () => {
    expect(main).toMatch(/import \{ mountStudio \} from 'golem-spec\/ui'/);
    expect(main).toContain("'../.kiro/specs/hover-hold/requirements.md?raw'");
    expect(main).toMatch(/mountStudio\(el, hover, md,/);
  });
  it('shoves the drone as a whole: the push body is the x2 body', () => {
    expect(main).toContain("primaryPushBody: 'x2'");
  });
  it('reads the robot files from /robot/ in the page and in the worker', () => {
    expect(main).toContain("setRobotBase(new URL('robot/', document.baseURI))");
    expect(worker).toContain("setRobotBase(new URL('../robot/', import.meta.url))");
  });
  it('gives the trial workers an app and a requirements resolver', () => {
    expect(worker).toMatch(/export const app = hover;/);
    expect(worker).toMatch(/export const requirements = studioRequirements\(hover\);/);
  });
  it('serves apps/hover/robot at /robot/ in dev and copies it into the build', () => {
    expect(vite).toContain("server.middlewares.use('/robot/'");
    expect(vite).toContain('generateBundle');
    expect(vite).toContain("const ROBOT = resolve(WEB, '../robot')");
  });
  it('imports the skeleton only through its public entry points', () => {
    for (const src of [main, worker]) expect(src).not.toMatch(/skeleton\/src/);
    expect(main).not.toMatch(/from 'golem-spec\/(?!ui')/);
  });
});

describe('the site wires /hover/ the way it wires /candy/', () => {
  it('registers the page, the studio chunk, the robot files, the nav note and the licence', () => {
    expect(repo('site/src/build/pages-plugin.ts')).toContain("{ name: 'hover', file: 'hover/index.html', id: 'hover' }");
    expect(repo('site/src/build/pages-plugin.ts')).toMatch(/STUDIOS = \['stagger', 'candy', 'hover'\]/);
    expect(repo('site/src/studio/load.ts')).toContain("hover: () => import('./hover')");
    expect(repo('site/src/build/layout.ts')).toContain("href: '/hover/'");
    expect(repo('site/src/build/layout.ts')).toContain('/hover/robot/LICENSE.txt');
    expect(repo('site/vite.config.ts')).toContain('@app\\/hover');
    expect(repo('site/vite.config.ts')).toContain('hover-hold/requirements.md');
    expect(existsSync(new URL('../../../site/hover/index.html', import.meta.url))).toBe(true);
  });
  it('mounts the same studio options as the page, through the worker script of serveStudioWorker', () => {
    const studio = repo('site/src/studio/hover.ts');
    const w = repo('site/src/studio/hover-worker.ts');
    expect(studio).toContain("primaryPushBody: 'x2'");
    expect(w).toContain('serveStudioWorker(app)');
    expect(w).toContain("setRobotBase(new URL('/hover/robot/', self.location.href))");
  });
});
