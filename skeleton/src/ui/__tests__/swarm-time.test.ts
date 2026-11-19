// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { SwarmClock } from '../core/swarm-clock.js';
import { BULLET_MS, BULLET_ORBIT_DEG, BULLET_RATE, BulletTime } from '../core/bullet-time.js';
import { GhostSwarm } from '../ghosts/ghost-swarm.js';
import { buildStage } from '../stage/stage-builder.js';
import { TOKENS } from '../core/theme-tokens.js';
import { RenderScheduler } from '../core/scheduler.js';
import { SignatureBar, PLAY_LABEL, FREEZE_LABEL } from '../signature/signature-bar.js';
import { FakeRaf } from './fakes.js';
import { modelFrom } from './generators/model.js';
import { result } from './generators/swarm.js';

function rig(reduced = false) {
  const parts = buildStage(modelFrom(3, [
    { type: 6, group: 2, body: 1, mesh: 0, size: [0.1, 0.1, 0.1] },
    { type: 2, group: 2, body: 2, mesh: 0, size: [0.05, 0.05, 0.05] },
  ]), THREE, new THREE.MeshBasicMaterial());
  const raf = new FakeRaf();
  const sched = new RenderScheduler({ raf: raf.raf, caf: raf.caf }, () => {});
  const breaks: { slot: number; first: boolean; z: number }[] = [];
  const swarm = new GhostSwarm(parts, THREE, {
    nbody: 3, tokens: TOKENS.dark, theme: 'dark', riseDepth: 1, reducedMotion: () => reduced, warn: () => {}, scheduler: sched,
    onBreak: (slot, _x, _y, z, first) => breaks.push({ slot, first, z }),
  });
  return { swarm, sched, breaks, raf };
}
const breaking = (worstAt: number) => ({ ...result(-1), worstAt });

describe('SwarmClock', () => {
  // Feature: golem-signature, Property 5: Swarm clock
  it('advances by rate × dt, not at all when frozen, and seek sets the time and freezes', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom('adv', 'seek', 'play', 'freeze'), fc.double({ min: 0, max: 2, noNaN: true }),
      fc.constantFrom(1, 0.1, 0)), { maxLength: 30 }), (ops) => {
      const c = new SwarmClock();
      for (const [op, x, r] of ops) {
        const before = c.now, frozen = c.frozen;
        c.rate = r;
        if (op === 'adv') { c.advance(x); expect(c.now).toBeCloseTo(frozen ? before : before + r * x, 12); }
        else if (op === 'seek') { c.seek(x); expect(c.now).toBe(x); expect(c.frozen).toBe(true); }
        else if (op === 'play') { c.play(); expect(c.frozen).toBe(false); }
        else { c.freeze(); expect(c.frozen).toBe(true); }
      }
    }), { numRuns: 200 });
  });
});

describe('BulletTime', () => {
  // Feature: golem-signature, Property 6: Bullet time
  it('plays at 0.1× for 1.2 s and turns monotonically from 0 to 40 degrees', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.array(fc.double({ min: 0, max: 3000, noNaN: true }), { minLength: 2 }), (t0, offs) => {
      const b = new BulletTime();
      expect(b.trigger(t0, 1, 2)).toBe(true);
      const ts = offs.map((o) => t0 + o).sort((x, y) => x - y);
      let prev = -1, sum = 0;
      for (const t of ts) {
        expect(b.rate(t)).toBe(t - t0 < BULLET_MS ? BULLET_RATE : 1);
        const a = b.angle(t);
        expect(a).toBeGreaterThanOrEqual(prev);
        expect(a).toBeLessThanOrEqual(BULLET_ORBIT_DEG);
        prev = a;
        sum += b.takeDelta(t);
      }
      expect(sum).toBeCloseTo(b.angle(ts[ts.length - 1] as number), 9);
    }), { numRuns: 200 });
  });
  it('does not restart while running, and cancel ends it', () => {
    const b = new BulletTime();
    b.trigger(0, 0, 0);
    expect(b.trigger(500, 9, 9)).toBe(false);
    expect(b.pivotX).toBe(0);
    expect(b.angle(BULLET_MS)).toBe(BULLET_ORBIT_DEG);
    b.cancel();
    expect(b.rate(100)).toBe(1);
    expect(b.turning()).toBe(false);
  });
});

describe('GhostSwarm time hooks', () => {
  it('reports each break once, flags the first of the generation, and resets the flag per generation', () => {
    const { swarm, breaks } = rig();
    swarm.beginGeneration();
    swarm.accept(breaking(0.5), { robustness: -1, worstAt: 0.5, warmup: 0.2 }, 0);
    swarm.accept(breaking(0.6), { robustness: -1, worstAt: 0.6, warmup: 0.2 }, 0);
    swarm.accept(result(1), { robustness: 1, worstAt: 0.7, warmup: 0.2 }, 0);
    swarm.commitGeneration(0);
    expect(swarm.playStart).toBe(0);
    expect(swarm.playDuration).toBeCloseTo(1, 9);
    for (let t = 0; t <= 1.2; t += 0.05) swarm.update(t);
    expect(breaks.map((b) => [b.slot, b.first])).toEqual([[0, true], [1, false]]);
    swarm.beginGeneration();
    swarm.accept(breaking(0.5), { robustness: -1, worstAt: 0.5, warmup: 0.2 }, 2);
    swarm.commitGeneration(2);
    for (let t = 2; t <= 3; t += 0.05) swarm.update(t);
    expect(breaks.at(-1)).toMatchObject({ slot: 0, first: true });
  });
  it('keeps a faded broken ghost for the scrubber and shows it again when time goes back', () => {
    const { swarm } = rig();
    swarm.beginGeneration();
    swarm.accept(breaking(0.4), { robustness: -1, worstAt: 0.4, warmup: 0.2 }, 0);
    swarm.commitGeneration(0);
    swarm.update(0.95);
    expect(swarm.shown).toBe(0);
    expect(swarm.scrubbable).toBe(true);
    const st = (swarm.meshes[0]!.geometry.getAttribute('aState') as THREE.InstancedBufferAttribute).array;
    expect(st[1]).toBe(0);
    swarm.update(0.1);
    expect(swarm.shown).toBe(1);
    expect(st[1]).toBeGreaterThan(0);
  });
  it('holds no render reason while frozen, and takes it back on play', () => {
    const { swarm, sched } = rig();
    swarm.beginGeneration();
    swarm.accept(result(1), { robustness: 1, worstAt: 0.7, warmup: 0.2 }, 0);
    swarm.commitGeneration(0);
    expect(sched.has('ghosts-running')).toBe(true);
    swarm.setFrozen(true);
    expect(sched.has('ghosts-running')).toBe(false);
    swarm.update(0.3);
    expect(sched.has('ghosts-running')).toBe(false);
    swarm.setFrozen(false);
    expect(sched.has('ghosts-running')).toBe(true);
  });
});

describe('SignatureBar', () => {
  it('shows the timeline only when asked, writes the ghost time, and calls the handlers', () => {
    const calls: string[] = [];
    const bar = new SignatureBar(document, { onScrub: (t) => calls.push(`scrub ${t}`), onPlay: () => calls.push('play'), onFreeze: () => calls.push('freeze') });
    document.body.appendChild(bar.el);
    bar.setTimeline(false, 0, 0, false);
    expect(bar.timelineVisible).toBe(false);
    bar.setTimeline(true, 1.234, 4, false);
    expect(bar.range.value).toBe('1.23');
    expect(bar.range.max).toBe('4.00');
    expect(bar.timeEl.textContent).toBe('1.23 s of 4.0 s');
    expect(bar.playBtn.textContent).toBe(FREEZE_LABEL);
    bar.playBtn.click();
    bar.range.value = '2.5';
    bar.range.dispatchEvent(new Event('input'));
    bar.setTimeline(true, 2.5, 4, true);
    expect(bar.playBtn.textContent).toBe(PLAY_LABEL);
    bar.playBtn.click();
    expect(calls).toEqual(['freeze', 'scrub 2.5', 'play']);
    const t = bar.addToggle('Long exposure', false, (on) => calls.push(`le ${on}`));
    t.click();
    expect(t.getAttribute('aria-pressed')).toBe('true');
    expect(calls.at(-1)).toBe('le true');
    bar.dispose();
  });
});
