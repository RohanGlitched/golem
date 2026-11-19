import { describe, expect, it } from 'vitest';
import { memoryFileSystem } from './fs.js';
import { canonicalJson, counterexampleEquals, createSeedDatabase, pinCounterexample } from './seed-db.js';
import type { PinnedSeedEntry } from './types.js';

const entry = (over: Partial<PinnedSeedEntry> = {}): PinnedSeedEntry => ({
  reqId: 'R2', scenario: { 'push.force': 168, 'push.angle': 2.356 }, seed: 2780164117,
  robustness: -0.043, shrunk: true, foundAfter: 41, ...over,
});
const PATH = '.golem/seeds/stagger/R2.json';

describe('seed database', () => {
  it('returns [] for a missing file and creates nothing', async () => {
    const fs = memoryFileSystem();
    const db = createSeedDatabase(fs);
    expect(await db.read('stagger', 'R2')).toEqual([]);
    expect(fs.files.size).toBe(0);
    expect(fs.count('writeFile', 'mkdir', 'rename')).toBe(0);
  });
  it('adds an entry, creating the directory and the file in canonical form', async () => {
    const fs = memoryFileSystem();
    const db = createSeedDatabase(fs);
    expect(await pinCounterexample(db, 'stagger', entry({ classification: 'robust', verificationSeeds: [1, 2, 3], verificationRobustness: [-1, null, -2] }))).toBe('added');
    const text = fs.files.get(PATH) as string;
    expect(text.endsWith('}\n]\n')).toBe(true);
    expect(text).toContain('\n    "classification": "robust",');
    expect(text.indexOf('"classification"')).toBeLessThan(text.indexOf('"foundAfter"'));
    expect(fs.files.size).toBe(1);
    expect(await db.read('stagger', 'R2')).toHaveLength(1);
  });
  it('leaves the file untouched for a duplicate', async () => {
    const fs = memoryFileSystem();
    const db = createSeedDatabase(fs);
    await db.add('stagger', entry());
    const before = fs.files.get(PATH);
    fs.log.length = 0;
    expect(await db.add('stagger', entry({ robustness: -9, shrunk: false, foundAfter: 3 }))).toBe('duplicate');
    expect(fs.files.get(PATH)).toBe(before);
    expect(fs.count('writeFile', 'rename')).toBe(0);
  });
  it('treats a different seed or value as a new entry', async () => {
    expect(counterexampleEquals(entry(), entry({ seed: 1 }))).toBe(false);
    expect(counterexampleEquals(entry(), entry({ scenario: { 'push.force': 168, 'push.angle': 2.357 } }))).toBe(false);
    expect(counterexampleEquals(entry(), entry({ scenario: { 'push.force': 168 } }))).toBe(false);
  });
  it('names the path and the parse position for invalid JSON', async () => {
    const fs = memoryFileSystem({ [PATH]: '[{"reqId": ' });
    await expect(createSeedDatabase(fs).read('stagger', 'R2')).rejects.toThrow(/seed\/?s?.*R2\.json.*invalid JSON/s);
    expect(fs.files.get(PATH)).toBe('[{"reqId": ');
  });
  it('rejects a non-array file', async () => {
    const fs = memoryFileSystem({ [PATH]: '{}' });
    await expect(createSeedDatabase(fs).read('stagger', 'R2')).rejects.toThrow(/must hold a JSON array/);
  });
  it('names the index of the first invalid entry', async () => {
    const fs = memoryFileSystem({ [PATH]: JSON.stringify([entry(), { reqId: 'R2' }]) });
    await expect(createSeedDatabase(fs).read('stagger', 'R2')).rejects.toThrow(/R2\.json: entry 1 is invalid/);
  });
  it('keeps the previous file and removes the temp file when writeFile fails', async () => {
    const fs = memoryFileSystem();
    const db = createSeedDatabase(fs);
    await db.add('stagger', entry());
    const before = fs.files.get(PATH);
    fs.failOn('writeFile', 1, new Error('disk full'));
    await expect(db.add('stagger', entry({ seed: 5 }))).rejects.toThrow(/R2\.json.*disk full/);
    expect(fs.files.get(PATH)).toBe(before);
    expect([...fs.files.keys()]).toEqual([PATH]);
  });
  it('keeps the previous file and removes the temp file when rename fails', async () => {
    const fs = memoryFileSystem();
    const db = createSeedDatabase(fs);
    await db.add('stagger', entry());
    const before = fs.files.get(PATH);
    fs.failOn('rename', 1);
    await expect(db.add('stagger', entry({ seed: 5 }))).rejects.toThrow(/R2\.json/);
    expect(fs.files.get(PATH)).toBe(before);
    expect([...fs.files.keys()]).toEqual([PATH]);
  });
  it('rejects non-finite numbers when writing', async () => {
    const db = createSeedDatabase(memoryFileSystem());
    await expect(db.add('stagger', entry({ robustness: -Infinity }))).rejects.toThrow(/robustness/);
    expect(() => canonicalJson([entry({ verificationSeeds: [1, 2, NaN] })])).toThrow(/non-finite/);
  });
  it('rejects bad ids with no file-system call', async () => {
    const fs = memoryFileSystem();
    const db = createSeedDatabase(fs);
    await expect(db.read('../x', 'R2')).rejects.toThrow(/\.\.\//);
    await expect(db.read('stagger', '')).rejects.toThrow(/requirement id/);
    expect(fs.log).toHaveLength(0);
    expect(createSeedDatabase(fs).pathFor('stagger', '2.1')).toBe('.golem/seeds/stagger/2.1.json');
  });
});
