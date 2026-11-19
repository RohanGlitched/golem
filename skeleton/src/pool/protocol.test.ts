import { describe, expect, it } from 'vitest';
import type { HostMessage, WorkerMessage } from './protocol.js';
import { transferList } from './protocol.js';

const spec = { app: 'a', reqId: 'R1', scenario: { x: 1 }, seed: 3 };
const result = (poses: boolean): WorkerMessage => ({
  type: 'result', id: 1,
  result: { spec, robustness: 1, worstAt: 0, unit: 'm', wallMs: 1, ...(poses ? { poses: { fps: 50, nbody: 1, frames: new Float32Array(14) } } : {}) },
});

describe('protocol', () => {
  it('lists the frames buffer for a result with poses', () => {
    const m = result(true);
    const list = transferList(m);
    expect(list).toHaveLength(1);
    if (m.type !== 'result') throw new Error('unreachable');
    expect(list[0]).toBe(m.result.poses!.frames.buffer);
  });
  it('lists nothing for a result without poses and for other messages', () => {
    expect(transferList(result(false))).toEqual([]);
    expect(transferList({ type: 'ready', slot: 0 })).toEqual([]);
    expect(transferList({ type: 'trialError', id: 1, message: 'x' })).toEqual([]);
  });
  it('keeps every message structured-clone safe', () => {
    const host: HostMessage[] = [
      { type: 'init', slot: 0, appId: 'a', config: { trialModule: 'file:///x.mjs', nested: { a: [1, 2] } } },
      { type: 'run', id: 1, spec }, { type: 'cancel', id: 1 }, { type: 'probe', id: 2 }, { type: 'shutdown' },
    ];
    const worker: WorkerMessage[] = [
      { type: 'ready', slot: 0 }, { type: 'loadError', slot: 0, message: 'm', stack: 's' }, result(true),
      { type: 'trialError', id: 1, message: 'm' }, { type: 'probeReply', id: 2, liveHandles: 4 },
      { type: 'log', level: 'info', message: 'hi' },
    ];
    for (const m of [...host, ...worker]) {
      const copy = structuredClone(m);
      expect(copy).toEqual(m);
    }
  });
});
