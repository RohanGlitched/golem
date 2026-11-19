// The golem-sim Test_App (pendulum bob and free box), dressed for the studio demo:
// - its geoms are put in group 2 (the visual group the stage draws);
// - its lexicon gets two predicates over the app's own signals;
// - the push arrow points along the pushed direction.
import { testApp } from '../src/sim/index.js';
import type { RobotApp } from '../src/sim/types.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

async function files(): Promise<Record<string, Uint8Array>> {
  const f = await testApp.files();
  const xml = dec.decode(f['scene.xml']);
  const dressed = xml.replace(/<mujoco model="([^"]+)">/, '<mujoco model="$1">\n  <default><geom group="2"/></default>');
  return { ...f, 'scene.xml': enc.encode(dressed) };
}

const push = testApp.lexicon.perturbations[0]!;

export const demoApp: RobotApp = {
  ...testApp,
  id: 'test',
  name: 'Test pendulum and box',
  files,
  lexicon: {
    robotNames: ['robot', 'golem'],
    episodeSeconds: 2.5,
    predicates: [
      {
        phrase: 'keep the bob within {angle}',
        signals: ['bob.angle'],
        unit: 'rad',
        margin: (s, slots) => (slots['angle'] as number) - Math.abs(s['bob.angle'] as number),
      },
      {
        phrase: 'keep the box above {length}',
        signals: ['box.z'],
        unit: 'm',
        margin: (s, slots) => (s['box.z'] as number) - (slots['length'] as number),
      },
    ],
    perturbations: [{
      ...push,
      // Name the direction dimension after its slot, so the compiled call passes it to apply().
      dims: (slots) => push.dims(slots).map((d) => (d.kind === 'angle' ? { ...d, name: 'push.direction' } : d)),
      apply: (ctx, t, tTrigger, v) => push.apply(ctx, t, tTrigger, { ...v, angle: v['direction'] ?? 0 }),
      visual: (v) => {
        const f = v['force'] ?? 0, a = v['direction'] ?? 0;
        return { force: [f * Math.cos(a), f * Math.sin(a), 0], at: 'bob' };
      },
    }],
  },
};
