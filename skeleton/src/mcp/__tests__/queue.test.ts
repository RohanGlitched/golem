import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTimeCap } from '../cap.js';
import { FifoQueue, WriteQueue } from '../queue.js';

const never = new AbortController().signal;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('FifoQueue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs jobs one at a time in arrival order', async () => {
    const q = new FifoQueue();
    const log: string[] = [];
    const job = (n: string, ms: number) => async () => { log.push(`start ${n}`); expect(q.active).toBe(1); await sleep(ms); log.push(`end ${n}`); return n; };
    const ps = [q.run(job('a', 30), never), q.run(job('b', 10), never), q.run(job('c', 1), never)];
    await vi.advanceTimersByTimeAsync(100);
    expect(await Promise.all(ps)).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(q.active).toBe(0);
  });

  it('skips a job aborted while queued without blocking the rest', async () => {
    const q = new FifoQueue();
    const ctl = new AbortController();
    const ran: string[] = [];
    const first = q.run(async () => { await sleep(10); ran.push('a'); }, never);
    const second = q.run(async () => { ran.push('b'); }, ctl.signal);
    const third = q.run(async () => { ran.push('c'); }, never);
    const settled = second.catch((e: unknown) => e);
    ctl.abort();
    await vi.advanceTimersByTimeAsync(50);
    await first; await third;
    expect(await settled).toMatchObject({ name: 'AbortError' });
    expect(ran).toEqual(['a', 'c']);
  });

  it('rejects at once when the signal is already aborted, and WriteQueue behaves the same', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(new WriteQueue().run(async () => 1, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('withTimeCap', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('aborts the body signal when the cap fires and reports capped', async () => {
    const p = withTimeCap(2, never, (signal) => new Promise((_, rej) => {
      signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
    }));
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ capped: true });
  });

  it('propagates a parent abort to the body signal without reporting capped', async () => {
    const parent = new AbortController();
    let seen = false;
    const p = withTimeCap(60, parent.signal, async (signal) => { await sleep(5); seen = signal.aborted; return 'x'; });
    parent.abort();
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toEqual({ value: 'x', capped: false });
    expect(seen).toBe(true);
  });

  it('returns the value of a body that finishes in time and rethrows other errors', async () => {
    const p = withTimeCap(60, never, async () => 7);
    expect(await p).toEqual({ value: 7, capped: false });
    await expect(withTimeCap(60, never, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
