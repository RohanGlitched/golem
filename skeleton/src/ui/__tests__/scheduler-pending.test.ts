import { describe, expect, it } from 'vitest';
import { RenderScheduler } from '../core/scheduler.js';
import { FakeRaf } from './fakes.js';

describe('RenderScheduler pending frames', () => {
  it('keeps one pending callback when a tick requests a frame while a reason is held', () => {
    const raf = new FakeRaf();
    let sched!: RenderScheduler;
    let ticks = 0;
    sched = new RenderScheduler({ raf: raf.raf, caf: raf.caf }, () => { ticks++; sched.requestOnce(); });
    sched.acquire('simulating');
    for (let i = 0; i < 10; i++) {
      expect(raf.pending).toBe(1);
      raf.runNext();
    }
    expect(ticks).toBe(10);
    expect(raf.pending).toBe(1);
  });
});
