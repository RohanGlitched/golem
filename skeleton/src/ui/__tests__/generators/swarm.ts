import * as THREE from 'three';
import { buildStage } from '../../stage/stage-builder.js';
import { GhostSwarm } from '../../ghosts/ghost-swarm.js';
import { TOKENS } from '../../core/theme-tokens.js';
import { RenderScheduler } from '../../core/scheduler.js';
import { FakeRaf, synthPoses } from '../fakes.js';
import { modelFrom } from './model.js';
import type { TrialResult } from '../../types.js';

export function swarmRig(reduced = false, nbody = 3) {
  const parts = buildStage(modelFrom(nbody, [
    { type: 6, group: 2, body: 1, mesh: 0, size: [0.1, 0.1, 0.1] },
    { type: 2, group: 2, body: 2, mesh: 0, size: [0.05, 0.05, 0.05] },
  ]), THREE, new THREE.MeshBasicMaterial());
  const warns: string[] = [];
  const raf = new FakeRaf();
  const sched = new RenderScheduler({ raf: raf.raf, caf: raf.caf }, () => {});
  const swarm = new GhostSwarm(parts, THREE, {
    nbody, tokens: TOKENS.dark, theme: 'dark', riseDepth: 1, reducedMotion: () => reduced, warn: (m) => warns.push(m), scheduler: sched,
  });
  return { parts, swarm, warns, sched };
}

export const result = (robustness = 1, frames = 31, nbody = 3): TrialResult => ({
  spec: { app: 'test', reqId: 'R1', scenario: {}, seed: 1, record: 'poses' }, robustness, worstAt: 0.7, unit: 'rad', wallMs: 1,
  poses: synthPoses(nbody, frames),
});
