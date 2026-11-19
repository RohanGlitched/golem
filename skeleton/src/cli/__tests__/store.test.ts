import { describe, expect, it } from 'vitest';
import {
  appendOverride, atomicWriteFile, mergeReport, readGateState, readReport, stableJson, tmpCounter, writeGateState, writeReport,
} from '../store.js';
import type { ReportFile, ReportVerdict } from '../types.js';
import { createMemoryFs } from '../../../test/support/memory-fs.js';

const v = (reqId: string, status: ReportVerdict['status'] = 'held'): ReportVerdict => ({
  reqId, status, trials: 3, randomTrials: 3, guidedTrials: 0, closest: { robustness: 0.5, scenario: { f: 1 }, seed: 1 }, ms: 1,
});
const meta = { budget: { maxTrials: 24 }, durationS: 1, searchSeed: 1 };
const report = (verdicts: ReportVerdict[], overrides: ReportFile['gateOverrides'] = []): ReportFile => ({ schema: 1, verdicts, meta, gateOverrides: overrides });

describe('atomicWriteFile', () => {
  it('creates the directory, writes through a temp file and renames', async () => {
    const fs = createMemoryFs();
    await atomicWriteFile(fs, '/a/b/c.json', 'x', tmpCounter('t'));
    expect(fs.text('/a/b/c.json')).toBe('x');
    expect(fs.log).toContain('write /a/b/c.json.tmp-t0');
    expect(fs.list()).toEqual(['/a/b/c.json']);
  });

  it('keeps the old file, removes the temp file and names the path when the rename fails', async () => {
    const fs = createMemoryFs({ '/a/c.json': 'old' });
    fs.failOn('rename', 'c.json');
    await expect(atomicWriteFile(fs, '/a/c.json', 'new', tmpCounter())).rejects.toThrow(/cannot write \/a\/c\.json/);
    expect(fs.text('/a/c.json')).toBe('old');
    expect(fs.list()).toEqual(['/a/c.json']);
  });
});

describe('stableJson', () => {
  it('sorts keys, writes non-finite numbers as null and ends with a newline', () => {
    expect(stableJson({ b: 1, a: [NaN, Infinity, { z: 1, y: 2 }] })).toBe('{\n  "a": [\n    null,\n    null,\n    {\n      "y": 2,\n      "z": 1\n    }\n  ],\n  "b": 1\n}\n');
  });
});

describe('report', () => {
  it('replaces every verdict for scope all and keeps gate overrides', () => {
    const o = { sessionId: 's', timestamp: 't', count: 5, brokenReqIds: ['1'] };
    const m = mergeReport(report([v('1'), v('2')], [o]), [v('3')], meta, 'all');
    expect(m.verdicts.map((x) => x.reqId)).toEqual(['3']);
    expect(m.gateOverrides).toEqual([o]);
  });

  it('replaces only the named entry for scope reqId, or appends it', () => {
    const prev = report([v('1'), v('2')]);
    const m = mergeReport(prev, [v('2', 'broken')], meta, { reqId: '2' });
    expect(m.verdicts.map((x) => x.status)).toEqual(['held', 'broken']);
    expect(mergeReport(undefined, [v('9')], meta, { reqId: '9' }).verdicts).toHaveLength(1);
    expect(mergeReport(prev, [v('7')], meta, { reqId: '7' }).verdicts.map((x) => x.reqId)).toEqual(['1', '2', '7']);
  });

  it('appends an override and keeps earlier ones', () => {
    const o = (n: number) => ({ sessionId: 's', timestamp: String(n), count: 5, brokenReqIds: [] });
    expect(appendOverride(report([], [o(1)]), o(2)).gateOverrides.map((x) => x.timestamp)).toEqual(['1', '2']);
  });

  it('reads a written report, returns {} for a missing file and unreadable for bad content', async () => {
    const fs = createMemoryFs();
    expect(await readReport(fs, '/r.json')).toEqual({});
    await writeReport(fs, '/r.json', report([v('1')]), tmpCounter());
    expect((await readReport(fs, '/r.json')).report?.verdicts[0]?.reqId).toBe('1');
    fs.put('/bad.json', '{ nope');
    expect((await readReport(fs, '/bad.json')).unreadable).toContain('/bad.json');
    fs.put('/odd.json', '{"schema":2}');
    expect((await readReport(fs, '/odd.json')).unreadable).toContain('not a golem report');
  });
});

describe('gate state', () => {
  it('is silently empty when the file is missing', async () => {
    const w: string[] = [];
    expect(await readGateState(createMemoryFs(), '/g.json', (m) => w.push(m))).toEqual({});
    expect(w).toEqual([]);
  });

  it('is empty with a warning that names the path when invalid', async () => {
    const fs = createMemoryFs({ '/g.json': '{"s":{"count":"x"}}' });
    const w: string[] = [];
    expect(await readGateState(fs, '/g.json', (m) => w.push(m))).toEqual({});
    expect(w[0]).toContain('/g.json');
  });

  it('round-trips through a temp file and rename', async () => {
    const fs = createMemoryFs();
    const s = { a: { count: 2, updatedAt: '2026-10-31T04:00:00.000Z' } };
    await writeGateState(fs, '/.golem/gate-state.json', s, tmpCounter());
    expect(await readGateState(fs, '/.golem/gate-state.json', () => undefined)).toEqual(s);
    expect(fs.log.some((l) => l.startsWith('rename /.golem/gate-state.json.tmp-'))).toBe(true);
  });
});
