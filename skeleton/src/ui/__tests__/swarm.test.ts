import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GHOST_FRAG, GHOST_VERT, createGhostMaterial, ghostAlpha } from '../ghosts/ghost-shader.js';
import { TOKENS } from '../core/theme-tokens.js';
import { result, swarmRig } from './generators/swarm.js';
import type { TrialResult } from '../types.js';

const meta = (r: TrialResult) => ({ robustness: r.robustness, worstAt: r.worstAt, warmup: 0.2 });

describe('ghost material', () => {
  it('is transparent with no depth write, additive in dark and normal in light', () => {
    const d = createGhostMaterial(THREE, TOKENS.dark, 'dark', 1);
    expect([d.transparent, d.depthWrite, d.blending]).toEqual([true, false, THREE.AdditiveBlending]);
    expect(createGhostMaterial(THREE, TOKENS.light, 'light', 1).blending).toBe(THREE.NormalBlending);
  });
  it('has no time uniform', () => {
    expect(GHOST_VERT + GHOST_FRAG).not.toMatch(/time/i);
  });
  it('discards a zero opacity', () => {
    expect(ghostAlpha(0, 0.5)).toBeUndefined();
    expect(ghostAlpha(0.5, 1)).toBeCloseTo(0.05, 12);
  });
});

describe('GhostSwarm', () => {
  it('keeps the first 64 results of a generation', () => {
    const { swarm } = swarmRig();
    swarm.beginGeneration();
    const out = Array.from({ length: 70 }, () => swarm.accept(result(), meta(result())));
    expect(out.filter((x) => x === 'ok')).toHaveLength(64);
    expect(out.slice(64)).toEqual(Array(6).fill('ignored-full'));
    expect(swarm.shown).toBe(64);
    expect(swarm.count).toBe(64);
  });
  it('rejects an nbody mismatch with both numbers', () => {
    const { swarm, warns } = swarmRig();
    swarm.beginGeneration();
    expect(swarm.accept(result(1, 10, 4), meta(result()))).toBe('rejected');
    expect(warns).toEqual(['Ghost rejected: result has nbody 4 but the model has 3']);
  });
  it('creates no ghost for a result without poses', () => {
    const { swarm, warns } = swarmRig();
    swarm.beginGeneration();
    const r = result(); delete r.poses;
    expect(swarm.accept(r, meta(r))).toBe('rejected');
    expect(swarm.shown).toBe(0);
    expect(warns).toEqual([]);
  });
  it('hides every slot on clear', () => {
    const { swarm, sched } = swarmRig();
    swarm.beginGeneration();
    for (let i = 0; i < 5; i++) swarm.accept(result(), meta(result()));
    expect(sched.has('ghosts-running')).toBe(true);
    swarm.clear();
    expect(swarm.shown).toBe(0);
    expect(swarm.meshes.every((m) => m.count === 0)).toBe(true);
    expect(sched.has('ghosts-running')).toBe(false);
  });
  it('shows a staged ghost within 100 ms of the first result', () => {
    const { swarm } = swarmRig();
    swarm.beginGeneration();
    swarm.accept(result(), meta(result()), 10);
    expect(swarm.update(10.1)).toBe(true);
    const st = (swarm.meshes[0]!.geometry.getAttribute('aState') as THREE.InstancedBufferAttribute).array;
    expect(st[1]).toBeGreaterThan(0);
    expect(swarm.timeOf(0, 10.1)).toBe(0);
  });
  it('hides arrows after the perturbation window', () => {
    const { swarm } = swarmRig();
    swarm.beginGeneration();
    const r = result();
    swarm.accept(r, { ...meta(r), arrow: { body: 1, dir: [1, 0, 0], length: 0.3, tEnd: 0.2 } }, 0);
    swarm.commitGeneration(0);
    swarm.update(0.15);
    const ast = (swarm.arrowMesh.geometry.getAttribute('aState') as THREE.InstancedBufferAttribute).array;
    expect(ast[1]).toBeGreaterThan(0);
    swarm.update(0.25);
    expect(ast[1]).toBe(0);
  });
  it('returns false from update when everything has ended and releases ghosts-running', () => {
    const { swarm, sched } = swarmRig();
    swarm.beginGeneration();
    const r = result(-1);
    swarm.accept(r, meta(r), 0);
    swarm.commitGeneration(0);
    expect(swarm.update(0.6)).toBe(true);
    expect(swarm.update(0.5 + 0.6 + 0.01)).toBe(false);
    expect(swarm.shown).toBe(0);
    expect(sched.has('ghosts-running')).toBe(false);
  });
  it('retires leftover slots of the previous generation over 300 ms', () => {
    const { swarm } = swarmRig();
    swarm.beginGeneration();
    for (let i = 0; i < 3; i++) swarm.accept(result(), meta(result()), 0);
    swarm.commitGeneration(0);
    swarm.beginGeneration();
    swarm.accept(result(), meta(result()), 1);
    swarm.commitGeneration(1);
    swarm.update(1.1);
    expect(swarm.shown).toBe(3);
    swarm.update(1.31);
    expect(swarm.shown).toBe(1);
  });
  it('disposes every instanced mesh it created and leaves the hero geometry alone', () => {
    const { swarm, parts } = swarmRig();
    let disposed = 0;
    swarm.material.addEventListener('dispose', () => { disposed++; });
    swarm.dispose();
    expect(disposed).toBe(1);
    expect(parts.meshes[0]!.geometry.getAttribute('aState')).toBeUndefined();
    expect(parts.meshes[0]!.geometry.getAttribute('position')).toBeDefined();
  });
});
