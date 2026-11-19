// Feature: candy-app, Property 39: the studio page serves the robot, carries the app's copy and lets the pointer drag the hand
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { compileRobot } from './helpers/mujoco';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = read('web/index.html');
const main = read('web/main.ts');
const worker = read('web/worker.ts');
const vite = read('web/vite.config.ts');

describe('studio page: copy', () => {
  it('explains the doorstep, the trick-or-treaters, the suction cup and speed-and-separation monitoring', () => {
    for (const word of ['doorstep', 'Trick-or-treaters', 'suction cup', 'Speed-and-separation monitoring', 'SSM_v1']) {
      expect(html, word).toContain(word);
    }
  });
  it('says what "from any direction" means in this app, with the 120 degree arc, and says that a held line is not a proof', () => {
    expect(html).toContain('"from any direction" means the doorstep half');
    expect(html).toContain('120°');
    expect(html).toContain('not a proof');
  });
  it('names the two lines that are expected to break', () => {
    expect(html).toContain('Lines 1.1 and 8.1');
  });
  it('states heights and distances with units', () => {
    expect(html).toContain('0.05 m to 0.25 m');
    expect(html).toContain('0.10 m');
  });
});

describe('studio page: wiring', () => {
  it('mounts the studio on the candy app with the requirements file of this app', () => {
    expect(main).toMatch(/import \{ mountStudio \} from 'golem-spec\/ui'/);
    expect(main).toContain("'../.kiro/specs/candy-sorter/requirements.md?raw'");
    expect(main).toMatch(/mountStudio\(el, candy, md,/);
  });
  it('carries the hand with the pointer, within the rule of constrainDraggedHand', () => {
    expect(main).toMatch(/dragBody: \{ body: 'hand', noun: 'hand', constrain: constrainDraggedHand \}/);
  });
  it('reads the robot files from /robot/ in the page and in the worker', () => {
    expect(main).toContain("setRobotBase(new URL('robot/', document.baseURI))");
    expect(worker).toContain("setRobotBase(new URL('../robot/', import.meta.url))");
  });
  it('gives the trial workers an app and a requirements resolver', () => {
    expect(worker).toMatch(/export const app = candy;/);
    expect(worker).toMatch(/export const requirements = studioRequirements\(candy\);/);
  });
  it('serves apps/candy/robot at /robot/ in dev and copies it into the build', () => {
    expect(vite).toContain("server.middlewares.use('/robot/'");
    expect(vite).toContain('generateBundle');
    expect(vite).toContain("fileName: `robot/");
  });
  it('imports the skeleton only through its public entry points', () => {
    for (const src of [main, worker]) expect(src).not.toMatch(/skeleton\/src/);
    expect(main).not.toMatch(/from 'golem-spec\/(?!ui')/);
  });
});

const { mj, model } = await compileRobot();
afterAll(() => { model.delete(); });

describe('studio page: the stage draws the whole scene', () => {
  const name = (g: number): string => mj.mj_id2name(model, mj.mjtObj.mjOBJ_GEOM.value, g) ?? `#${g}`;

  it('puts every geom that is not a collision proxy in group 2, which is the only group the studio draws', () => {
    const outside: string[] = [];
    for (let g = 0; g < model.ngeom; g++) {
      const group = model.geom_group[g] as number;
      if (group !== 2 && group !== 3) outside.push(`${name(g)} (group ${group})`);
    }
    expect(outside).toEqual([]);
  });
  it('draws the table, the bowls, the candies and every part of the hand', () => {
    const drawn = new Set<string>();
    for (let g = 0; g < model.ngeom; g++) if (model.geom_group[g] === 2) drawn.add(name(g));
    for (const n of ['table', 'bowl_orange_floor', 'bowl_green_wall_px', 'candy_0_geom', 'candy_5_geom', 'hand_palm', 'hand_forearm', 'doorstep']) {
      expect(drawn.has(n), n).toBe(true);
    }
  });
  it('keeps the hand a mocap body, so the pointer can move it', () => {
    const hand = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, 'hand');
    expect(hand).toBeGreaterThan(0);
    expect(model.body_mocapid[hand]).toBeGreaterThanOrEqual(0);
  });
});
