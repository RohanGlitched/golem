import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { makeTestRequirement, testApp } from '../../sim/index.js';
import { StudioPool, createStudioPool, NO_WORKERS_TEXT, workersFailedText } from '../run/studio-pool.js';
import { decodeReqKey, encodeReqKey } from '../run/req-key.js';
import { studioRequirements } from '../worker.js';
import { FakePool, synthResult } from './fakes.js';
import { GOOD_LINE, lexApp } from './generators/lexicon.js';
import type { TrialResult, TrialSpec } from '../types.js';

const req = makeTestRequirement({ horizon: 0.5, id: '1.1', maxForce: 20 });
const spec = (seed = 1): TrialSpec => ({ app: 'test', reqId: '1.1', scenario: { 'push.force': 5, 'push.angle': 0 }, seed });
const loadError = (): Error => Object.assign(new Error('worker 0 failed to load: no MuJoCo'), { name: 'LoadError' });

describe('requirement keys', () => {
  it('round-trips any id without NUL and any line', () => {
    fc.assert(fc.property(fc.string().filter((s) => !s.includes('\u0000')), fc.string(), (id, source) => {
      expect(decodeReqKey(encodeReqKey(id, source))).toEqual({ id, source });
    }), { numRuns: 200 });
  });
  it('does not decode a plain id', () => {
    expect(decodeReqKey('1.1')).toBeUndefined();
  });
});

describe('studioRequirements (worker side)', () => {
  it('compiles the line carried by the key, once per distinct line', () => {
    const find = studioRequirements(lexApp);
    const a = find(encodeReqKey('R7', GOOD_LINE));
    expect(a?.id).toBe('R7');
    expect(a?.source).toBe(GOOD_LINE);
    expect(find(encodeReqKey('R7', GOOD_LINE))).toBe(a);
    const edited = find(encodeReqKey('R7', GOOD_LINE.replace('20 N', '30 N')));
    expect(edited).not.toBe(a);
    expect(edited?.space.dims.find((d) => d.name === 'push.force')?.max).toBe(30);
  });
  it('returns undefined for a plain id and throws for a line that does not compile', () => {
    const find = studioRequirements(lexApp);
    expect(find('1.1')).toBeUndefined();
    expect(() => find(encodeReqKey('R8', 'WHEN nothing THE robot SHALL do nothing'))).toThrow(/Requirement R8 cannot be tested in the worker/);
  });
});

describe('StudioPool', () => {
  it('sends the registered line in the reqId and returns the original id on every result', async () => {
    const workers = new FakePool((s) => synthResult(s));
    const pool = new StudioPool(testApp, workers);
    pool.register(req);
    const seen: string[] = [];
    const out = await pool.run([spec(1), spec(2)], (r) => seen.push(r.spec.reqId));
    expect(workers.calls[0]!.every((s) => decodeReqKey(s.reqId)?.source === req.source && decodeReqKey(s.reqId)?.id === '1.1')).toBe(true);
    expect(out.map((r) => r.spec.reqId)).toEqual(['1.1', '1.1']);
    expect(seen).toEqual(['1.1', '1.1']);
    expect(pool.mode).toBe('workers');
    expect(pool.size).toBe(workers.size);
  });
  it('sends an unregistered id unchanged', async () => {
    const workers = new FakePool((s) => synthResult(s));
    const pool = new StudioPool(testApp, workers);
    await pool.run([{ ...spec(), reqId: 'other' }]);
    expect(workers.calls[0]![0]!.reqId).toBe('other');
  });
  it('falls back to the in-process pool when the workers fail to load, tells the studio once, and closes the workers', async () => {
    const workers = new FakePool(() => { throw loadError(); });
    const pool = new StudioPool(testApp, workers);
    const told: string[] = [];
    pool.onFallback = (t) => told.push(t);
    pool.register(req);
    const out = await pool.run([spec()]);
    expect(out).toHaveLength(1);
    expect(out[0]!.spec.reqId).toBe('1.1');
    expect(Number.isFinite(out[0]!.robustness)).toBe(true);
    expect(pool.mode).toBe('inline');
    expect(told).toEqual([workersFailedText('worker 0 failed to load: no MuJoCo')]);
    expect(workers.closed).toBe(true);
    await pool.run([spec(2)]);
    expect(workers.calls).toHaveLength(1);
    expect(told).toHaveLength(1);
    await pool.close();
  }, 60000);
  it('rethrows an error that is not a LoadError, and a LoadError after a result was delivered', async () => {
    const crash = new StudioPool(testApp, new FakePool(() => { throw new Error('trial crashed'); }));
    await expect(crash.run([spec()])).rejects.toThrow('trial crashed');
    expect(crash.mode).toBe('workers');
    let n = 0;
    const late = new StudioPool(testApp, new FakePool((s) => { if (n++ === 1) throw loadError(); return synthResult(s); }));
    await expect(late.run([spec(1), spec(2)])).rejects.toThrow('failed to load');
    expect(late.mode).toBe('workers');
  });
  it('does not close or fall back after close, and rejects a run', async () => {
    const workers = new FakePool((s) => synthResult(s));
    const pool = new StudioPool(testApp, workers);
    await pool.close();
    expect(workers.closed).toBe(true);
    await expect(pool.run([spec()])).rejects.toThrow('closed');
  });
});

describe('createStudioPool', () => {
  it('runs in-process with a notice when no Worker global exists', async () => {
    const saved = (globalThis as { Worker?: unknown }).Worker;
    delete (globalThis as { Worker?: unknown }).Worker;
    try {
      const pool = createStudioPool(testApp, { workerUrl: '/app-module.js' });
      expect(pool.mode).toBe('inline');
      expect(pool.size).toBe(1);
      expect(pool.notice).toBe(NO_WORKERS_TEXT);
      await pool.close();
    } finally {
      if (saved !== undefined) (globalThis as { Worker?: unknown }).Worker = saved;
    }
  });
  it('builds a Web Worker pool when Worker exists, handing the workers the absolute app module URL', async () => {
    const created: { url: unknown; opts: unknown }[] = [];
    const posted: unknown[] = [];
    class FakeWorker {
      constructor(url: unknown, opts: unknown) { created.push({ url, opts }); }
      postMessage(m: unknown): void { posted.push(m); }
      addEventListener(): void {}
      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const pool = createStudioPool(testApp, { workerUrl: new URL('http://localhost/app-module.js'), entry: 'http://localhost/entry.js', size: 2 });
      expect(pool.mode).toBe('workers');
      expect(pool.notice).toBeUndefined();
      expect(pool.size).toBe(2);
      expect(created.map((c) => String(c.url))).toEqual(['http://localhost/entry.js', 'http://localhost/entry.js']);
      expect(posted[0]).toMatchObject({ type: 'init', appId: testApp.id, config: { appModule: 'http://localhost/app-module.js' } });
      await pool.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it('keeps a result without a key as it is', async () => {
  const workers = new FakePool((s): TrialResult => synthResult(s));
  const pool = new StudioPool(testApp, workers);
  const [r] = await pool.run([spec()]);
  expect(r!.spec.reqId).toBe('1.1');
});
