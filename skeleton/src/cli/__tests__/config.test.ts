import { describe, expect, it } from 'vitest';
import { ConfigError, formatConfig, locateApp, parseConfig } from '../config.js';
import { createMemoryFs } from '../../../test/support/memory-fs.js';

const cfg = (o: object): string => JSON.stringify(o);
const err = async (p: Promise<unknown>): Promise<ConfigError> => {
  try { await p; } catch (e) { return e as ConfigError; }
  throw new Error('expected failure');
};

describe('parseConfig', () => {
  it('reads a minimal config and drops unknown fields without complaint', () => {
    expect(parseConfig(cfg({ app: './a.js', requirements: ['r.md'], extra: 1 }), '/p/golem.config.json'))
      .toEqual({ app: './a.js', requirements: ['r.md'] });
  });

  it('names the path and the parse position for invalid JSON', () => {
    expect(() => parseConfig('{ nope', '/p/golem.config.json')).toThrow(/\/p\/golem\.config\.json: invalid JSON/);
  });

  it('names the first invalid field in the fixed order', () => {
    try {
      parseConfig(cfg({ app: 1, requirements: 'x', robot: 3 }), '/c');
      throw new Error('no failure');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).field).toBe('app');
      expect((e as ConfigError).message).toContain('/c');
    }
  });

  it('accepts an empty requirements list so the gate can say it has nothing to check', () => {
    expect(parseConfig(cfg({ app: 'a', requirements: [] }), '/c').requirements).toEqual([]);
  });

  it('rejects a toolTimeCapS of 0 and a searchSeed above uint32', () => {
    expect(() => parseConfig(cfg({ app: 'a', requirements: [], toolTimeCapS: 0 }), '/c')).toThrow(/toolTimeCapS/);
    expect(() => parseConfig(cfg({ app: 'a', requirements: [], searchSeed: 2 ** 32 }), '/c')).toThrow(/searchSeed/);
  });
});

describe('formatConfig', () => {
  it('writes fixed key order with 2-space indent and a trailing newline', () => {
    const t = formatConfig({ searchSeed: 3, robot: 'g1', requirements: ['a.md'], app: './app.js' });
    expect(t).toBe('{\n  "app": "./app.js",\n  "requirements": [\n    "a.md"\n  ],\n  "robot": "g1",\n  "searchSeed": 3\n}\n');
  });
});

describe('locateApp', () => {
  const valid = cfg({ app: './app.js', requirements: ['.kiro/specs/r/requirements.md'] });

  it('walks up from a subdirectory to the first config', async () => {
    const fs = createMemoryFs({ '/p/golem.config.json': valid, '/p/app/controller/x.ts': '' });
    const r = await locateApp('/p/app/controller', undefined, fs);
    expect(r.appDir).toBe('/p');
    expect(r.config.app).toBe('/p/app.js');
    expect(r.config.requirements).toEqual(['/p/.kiro/specs/r/requirements.md']);
  });

  it('prefers the nearest config', async () => {
    const fs = createMemoryFs({ '/p/golem.config.json': valid, '/p/a/golem.config.json': valid, '/p/a/b/x': '' });
    expect((await locateApp('/p/a/b', undefined, fs)).appDir).toBe('/p/a');
  });

  it('with --app looks only in that directory and never in a parent', async () => {
    const fs = createMemoryFs({ '/p/golem.config.json': valid, '/p/a/x': '' });
    const e = await err(locateApp('/p', 'a', fs));
    expect(e.message).toContain('/p/a');
    expect(e.message).toContain('npx golem-spec init');
  });

  it('keeps an absolute path in the config unchanged', async () => {
    const fs = createMemoryFs({ '/p/golem.config.json': cfg({ app: '/abs/app.js', requirements: ['/abs/r.md'] }) });
    const r = await locateApp('/p', undefined, fs);
    expect(r.config.app).toBe('/abs/app.js');
    expect(r.config.requirements).toEqual(['/abs/r.md']);
  });

  it('names the start directory and suggests golem init when nothing is found', async () => {
    const e = await err(locateApp('/x/y', undefined, createMemoryFs()));
    expect(e.message).toContain('/x/y');
    expect(e.message).toContain('npx golem-spec init');
  });

  it('works with a Windows drive path', async () => {
    const fs = createMemoryFs();
    fs.put('C:/proj/golem.config.json', valid);
    expect((await locateApp('C:\\proj\\app', undefined, fs)).appDir).toBe('C:/proj');
  });
});
