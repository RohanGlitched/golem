import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { evalGhost, newGhostEval } from '../ghosts/ghost-state.js';
import { nlerp } from '../core/pose-math.js';
import { result, swarmRig } from './generators/swarm.js';
import type { TrialResult } from '../types.js';

const R = { numRuns: 100 };
const unit = fc.double({ min: -1, max: 1, noNaN: true });
const arbQuat = fc.tuple(unit, unit, unit, unit).filter((q) => Math.hypot(...q) > 0.1).map((q) => { const n = Math.hypot(...q); return q.map((x) => x / n) as [number, number, number, number]; });
const arbBodyPose = fc.tuple(fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: 0, max: 2, noNaN: true }), arbQuat);

/** Pose frames for nbody bodies: f x nbody x (x, y, z, qw, qx, qy, qz). */
const arbFrames = (nbody: number, maxFrames = 12) => fc.array(fc.array(arbBodyPose, { minLength: nbody, maxLength: nbody }), { minLength: 1, maxLength: maxFrames })
  .map((fs) => Float32Array.from(fs.flatMap((f) => f.flatMap(([x, y, z, q]) => [x, y, z, ...q]))));

const withFrames = (frames: Float32Array, robustness = 1, nbody = 3): TrialResult => ({ ...result(robustness, 1, nbody), poses: { fps: 30, nbody, frames } });
const meta = (r: number) => ({ robustness: r, worstAt: 100, warmup: 0 });

describe('swarm properties', () => {
  // Feature: golem-studio-ui, Property 5: Ghost matrices compose and are deterministic
  it('writes body matrix times geom-local matrix, bit-identical on a second update', () => {
    fc.assert(fc.property(arbFrames(3), fc.double({ min: 0, max: 1, noNaN: true }), (frames, t) => {
      const { swarm, parts } = swarmRig(true);
      swarm.beginGeneration();
      swarm.accept(withFrames(frames), meta(1), 0);
      swarm.commitGeneration(0);
      swarm.update(t);
      const fc_ = frames.length / 21;
      const f = Math.min(fc_ - 1, Math.floor(t * 30));
      parts.geomInfo.forEach((gi, g) => {
        const o = (f * 3 + gi.body) * 7;
        const body = new THREE.Matrix4().compose(
          new THREE.Vector3(frames[o], frames[o + 1], frames[o + 2]),
          new THREE.Quaternion(frames[o + 4], frames[o + 5], frames[o + 6], frames[o + 3]).normalize(),
          new THREE.Vector3(1, 1, 1));
        const want = body.multiply(new THREE.Matrix4().fromArray(gi.local)).toArray();
        const got = Array.from((swarm.meshes[g]!.instanceMatrix.array as Float32Array).slice(0, 16));
        got.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThanOrEqual(1e-5 * (1 + Math.abs(want[i]!))));
      });
      const first = swarm.meshes.map((m) => Float32Array.from(m.instanceMatrix.array as Float32Array));
      swarm.update(t);
      swarm.meshes.forEach((m, g) => expect(Buffer.from((m.instanceMatrix.array as Float32Array).buffer).equals(Buffer.from(first[g]!.buffer))).toBe(true));
    }), R);
  });

  // Feature: golem-studio-ui, Property 13: Ghost frame selection and interpolation
  it('selects min(N - 1, floor(tau fps)), blends between neighbours and holds the last frame', () => {
    fc.assert(fc.property(arbFrames(1, 20), fc.double({ min: 0, max: 3, noNaN: true }), fc.integer({ min: 1, max: 60 }), fc.boolean(), (frames, tau, fps, reduced) => {
      const N = frames.length / 7;
      const e = evalGhost({ robustness: 1, worstAt: 0, warmup: 0, fps, frameCount: N, validFrames: N }, tau, reduced, newGhostEval());
      const T = (N - 1) / fps;
      // At or past the end the last frame is held exactly (T * fps may round to just below N - 1).
      expect(e.frame).toBe(tau >= T ? N - 1 : Math.min(N - 1, Math.floor(tau * fps)));
      expect(e.frame).toBeGreaterThanOrEqual(0);
      if (tau > T) expect(e.frame).toBe(N - 1);
      const out = new Float64Array(7);
      nlerp(frames, 1, e.frame, e.next, 0, e.alpha, out);
      for (let k = 0; k < 3; k++) {
        const a = frames[e.frame * 7 + k]!, b = frames[e.next * 7 + k]!;
        expect(out[k]!).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
        expect(out[k]!).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
      }
      expect(Math.hypot(out[3]!, out[4]!, out[5]!, out[6]!)).toBeCloseTo(1, 6);
      if (reduced) {
        expect(e.alpha).toBe(0);
        for (let k = 0; k < 3; k++) expect(out[k] === frames[e.frame * 7 + k]).toBe(true); // -0 and 0 are equal positions
      }
    }), R);
  });

  // Feature: golem-studio-ui, Property 14: Ghosts of one Generation are in sync
  it('gives every ghost of a committed generation the same time and staged ghosts time 0', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), fc.double({ min: 0, max: 100, noNaN: true }), fc.double({ min: -5, max: 20, noNaN: true }), (n, start, dt) => {
      const { swarm } = swarmRig();
      swarm.beginGeneration();
      for (let i = 0; i < n; i++) swarm.accept(result(), meta(1), start - i * 0.01);
      for (let i = 0; i < n; i++) expect(swarm.timeOf(i, start + dt)).toBe(0);
      swarm.commitGeneration(start);
      const now = start + dt;
      for (let i = 0; i < n; i++) expect(swarm.timeOf(i, now)).toBe(Math.max(0, now - start));
    }), R);
  });

  // Feature: golem-studio-ui, Property 17: Generation capacity
  it('shows the first min(n, 64) results of a generation and never more than 64', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 130 }), { minLength: 1, maxLength: 4 }), (gens) => {
      const { swarm } = swarmRig();
      let t = 0;
      for (const n of gens) {
        swarm.beginGeneration();
        for (let i = 0; i < n; i++) swarm.accept(result(1000 + i), meta(1000 + i), t);
        const m = Math.min(n, 64);
        for (let i = 0; i < m; i++) expect(swarm.robust[i]).toBe(1000 + i);
        swarm.update(t);
        expect(swarm.shown).toBeLessThanOrEqual(64);
        if (m > 0) expect(swarm.count).toBeGreaterThanOrEqual(m);
        expect(swarm.meshes[0]!.count).toBe(swarm.count);
        swarm.commitGeneration(t);
        t += 1;
        swarm.update(t);
        expect(swarm.shown).toBe(m);
        expect(swarm.count).toBe(m);
      }
    }), R);
  });

  // Feature: golem-studio-ui, Property 22: Pose frame validation
  it('rejects bad pose arrays with one warning and holds a ghost before the first non-finite frame', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 80 }), fc.integer({ min: 0, max: 79 }), fc.boolean(), fc.boolean(), (nb, len, bad, noPoses, inject) => {
      const { swarm, warns } = swarmRig(false, 3);
      swarm.beginGeneration();
      const frames = new Float32Array(len).fill(0.5);
      if (inject && len > 0) frames[bad % len] = Number.NaN;
      const r: TrialResult = noPoses ? { ...result(), poses: undefined } as unknown as TrialResult : { ...result(), poses: { fps: 30, nbody: nb, frames } };
      if (noPoses) delete (r as { poses?: unknown }).poses;
      const out = swarm.accept(r, meta(1), 0);
      if (noPoses) { expect(out).toBe('rejected'); expect(warns).toHaveLength(0); expect(swarm.shown).toBe(0); return; }
      const per = nb * 7;
      const firstBad = inject && len > 0 ? Math.floor((bad % len) / per) : Infinity;
      if (nb !== 3 || len === 0 || len % per !== 0 || firstBad === 0) {
        expect(out).toBe('rejected');
        expect(warns).toHaveLength(1);
        expect(swarm.shown).toBe(0);
        return;
      }
      expect(out).toBe('ok');
      const valid = Math.min(len / per, firstBad);
      expect(swarm.validFrames[0]).toBe(valid);
      swarm.commitGeneration(0);
      for (const t of [0, 0.5, 5]) {
        const e = evalGhost({ robustness: 1, worstAt: 0, warmup: 0, fps: 30, frameCount: len / per, validFrames: valid }, t, false, newGhostEval());
        expect(e.frame).toBeLessThanOrEqual(valid - 1);
        expect(e.next).toBeLessThanOrEqual(valid - 1);
      }
    }), R);
  });
});
