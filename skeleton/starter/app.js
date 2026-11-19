// GOLEM starter robot: a MuJoCo cart-pole that balances itself.
// This file is the whole app: the scene is robot/scene.xml, the words the requirements may use are in
// `lexicon` below, and the controller is `makeController`. Plain ES module, no build step.
// Edit the controller to change what the requirements in .kiro/specs/cartpole/requirements.md find.
import { readFile } from 'node:fs/promises';

const RAD2DEG = 180 / Math.PI;

// ---------------------------------------------------------------- controller

// Full-state feedback u = KX x + KTH th + KXD xd + KTHD thd, in newtons. The gains come from an LQR design for
// this cart (1 kg) and pole (0.1 kg, 0.6 m) at 50 Hz. The motor in scene.xml saturates at +-15 N, so the law
// recovers small pushes and cannot recover a push that needs more force than the motor has.
const KX = 1.25;
const KTH = 29.4;
const KXD = 2.2;
const KTHD = 5.8;
const FORCE_LIMIT = 15; // N, the same limit as ctrlrange in scene.xml
const START_TILT = 0.05; // rad, the pole starts within +-0.05 rad of upright

// ---------------------------------------------------------------- per-trial state

// Typed-array views into MuJoCo memory, read once per trial and again only if WASM memory growth detaches them.
const states = new WeakMap();

function stateOf(ctx) {
  let s = states.get(ctx);
  if (s === undefined) {
    const slider = ctx.ids['joint:slider'];
    const hinge = ctx.ids['joint:hinge'];
    s = {
      slideQpos: ctx.model.jnt_qposadr[slider], slideDof: ctx.model.jnt_dofadr[slider],
      hingeQpos: ctx.model.jnt_qposadr[hinge], hingeDof: ctx.model.jnt_dofadr[hinge],
      drive: ctx.ids['actuator:drive'], cart: ctx.ids['body:cart'],
      qpos: ctx.data.qpos, qvel: ctx.data.qvel, ctrl: ctx.data.ctrl, xfrc: ctx.data.xfrc_applied,
    };
    states.set(ctx, s);
  } else if (s.qpos.buffer.byteLength === 0) {
    s.qpos = ctx.data.qpos; s.qvel = ctx.data.qvel; s.ctrl = ctx.data.ctrl; s.xfrc = ctx.data.xfrc_applied;
  }
  return s;
}

// ---------------------------------------------------------------- the words requirements may use

// A predicate's margin is positive while it holds, in the unit it names (here degrees or metres).
const predicates = [
  {
    phrase: 'keep the pole within {angle} of upright',
    signals: ['pole_angle'],
    unit: 'deg',
    margin: (s, slots) => (slots.angle - Math.abs(s.pole_angle)) * RAD2DEG,
  },
  {
    phrase: 'keep the cart within {length} of the centre',
    signals: ['cart_x'],
    unit: 'm',
    margin: (s, slots) => slots.length - Math.abs(s.cart_x),
  },
];

// A perturbation is what a WHEN line injects. `force` is searched between 0 and the number written in the line.
const perturbations = [
  {
    phrase: 'the cart is pushed with {range:force} for {duration}',
    slots: { force: { dim: 'push.force', severity: 'up' } },
    apply(ctx, t, tTrigger, values) {
      if (t < tTrigger || t >= tTrigger + values.duration) return;
      const s = stateOf(ctx);
      s.xfrc[6 * s.cart] = values.force; // newtons along +x on the cart body
    },
    visual: (values) => ({ force: [values.force ?? 0, 0, 0], at: 'cart' }),
  },
];

// ---------------------------------------------------------------- the app

/** @type {import('golem-spec').RobotApp} */
const app = {
  id: 'cartpole',
  name: 'Cart-pole starter',
  sceneFile: 'scene.xml',
  simDt: 0.002,
  controlDt: 0.02,
  warmup: 0.5,
  lexicon: { robotNames: ['robot', 'cartpole'], predicates, perturbations, episodeSeconds: 6 },
  names: { body: ['cart'], joint: ['slider', 'hinge'], actuator: ['drive'] },

  // Reads robot/ next to this file, so the app works from any working directory.
  async files() {
    const scene = await readFile(new URL('./robot/scene.xml', import.meta.url));
    return { 'scene.xml': new Uint8Array(scene) };
  },

  initState(ctx, rng) {
    const s = stateOf(ctx);
    s.qpos[s.hingeQpos] = (rng() * 2 - 1) * START_TILT;
  },

  makeController(ctx) {
    stateOf(ctx);
    return {
      step(c) {
        const s = stateOf(c);
        const u = KX * s.qpos[s.slideQpos] + KTH * s.qpos[s.hingeQpos] + KXD * s.qvel[s.slideDof] + KTHD * s.qvel[s.hingeDof];
        s.ctrl[s.drive] = u > FORCE_LIMIT ? FORCE_LIMIT : u < -FORCE_LIMIT ? -FORCE_LIMIT : u;
      },
    };
  },

  signals(ctx, out) {
    const s = stateOf(ctx);
    out.pole_angle = s.qpos[s.hingeQpos]; // rad, positive leans toward +x
    out.cart_x = s.qpos[s.slideQpos]; // m from the centre of the rail
  },
};

export default app;
