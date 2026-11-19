import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ConfigError, locateApp } from '../config.js';
import { resolve } from '../paths.js';
import { createMemoryFs } from '../../../test/support/memory-fs.js';
import { propConfig } from '../../../test/support/prop.js';

const seg = fc.constantFrom('a', 'b', 'c', 'd');
const text = (app: string, req: string): string => JSON.stringify({ app, requirements: [req] });

describe('Property 5: config locator selects the nearest directory', () => {
  // Feature: golem-kit, Property 5: Config locator selects the nearest directory
  it('without --app picks the nearest directory at or above cwd that holds a config', async () => {
    await fc.assert(fc.asyncProperty(fc.array(seg, { minLength: 1, maxLength: 5 }), fc.infiniteStream(fc.boolean()), async (segs, flags) => {
      const dirs = ['/', ...segs.map((_, i) => `/${segs.slice(0, i + 1).join('/')}`)];
      const it = flags[Symbol.iterator]();
      const holders = dirs.filter(() => it.next().value === true);
      const fs = createMemoryFs();
      for (const d of holders) fs.put(`${d === '/' ? '' : d}/golem.config.json`, text('./app.js', 'r.md'));
      fs.put(`${dirs[dirs.length - 1]}/marker`, '');
      const cwd = dirs[dirs.length - 1] as string;
      if (holders.length === 0) {
        await expect(locateApp(cwd, undefined, fs)).rejects.toBeInstanceOf(ConfigError);
        return;
      }
      const nearest = holders[holders.length - 1] as string;
      const r = await locateApp(cwd, undefined, fs);
      expect(r.appDir).toBe(nearest);
      expect(r.config.app).toBe(resolve(nearest, './app.js'));
    }), propConfig);
  });

  it('with --app looks only in the resolved directory, never in a parent', async () => {
    await fc.assert(fc.asyncProperty(fc.array(seg, { minLength: 1, maxLength: 4 }), fc.boolean(), fc.boolean(), async (segs, hasConfig, absolute) => {
      const dir = `/${segs.join('/')}`;
      const fs = createMemoryFs({ '/golem.config.json': text('x.js', 'r.md'), [`${dir}/marker`]: '' });
      if (hasConfig) fs.put(`${dir}/golem.config.json`, text('x.js', '/abs/r.md'));
      const flag = absolute ? dir : segs.join('/');
      const cwd = absolute ? '/' : '/';
      if (!hasConfig) {
        const e = await locateApp(cwd, flag, fs).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(ConfigError);
        expect((e as ConfigError).message).toContain(dir);
        return;
      }
      const r = await locateApp(cwd, flag, fs);
      expect(r.appDir).toBe(dir);
      expect(r.config.requirements).toEqual(['/abs/r.md']);
      expect(r.config.app).toBe(`${dir}/x.js`);
    }), propConfig);
  });
});
