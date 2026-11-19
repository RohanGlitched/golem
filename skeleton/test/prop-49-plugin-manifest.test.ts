import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLUGIN_FIELDS, checkPluginManifest } from '../scripts/pack-checks/power.js';
import { SKELETON_DIR } from './support/pack.js';
import { propConfig } from './support/prop.js';

const valid = (): Record<string, unknown> => ({ $schema: 'x', name: 'golem', version: '1.2.3', description: 'd', license: 'Apache-2.0', keywords: ['a'] });
const MUT: Record<string, (m: Record<string, unknown>) => void> = {
  extraField: (m) => { m['skills'] = ['skills/a']; },
  badVersion: (m) => { m['version'] = '1.2'; },
  noName: (m) => { delete m['name']; },
  emptyDescription: (m) => { m['description'] = ' '; },
  wrongLicense: (m) => { m['license'] = 'MIT'; },
  noLicense: (m) => { delete m['license']; },
  badKeywords: (m) => { m['keywords'] = [1]; },
};

describe('Property 49: plugin manifest closed schema', () => {
  // Feature: golem-kit, Property 49: Plugin manifest closed schema
  it('accepts a manifest if and only if only permitted fields appear and the required ones are valid', () => {
    fc.assert(fc.property(fc.subarray(Object.keys(MUT)), fc.subarray([...PLUGIN_FIELDS].filter((f) => !['name', 'version', 'description', 'license'].includes(f)) as string[]), (muts, optional) => {
      const m = valid();
      for (const f of ['author', 'homepage', 'repository', 'extensions']) if (optional.includes(f)) m[f] = 'x';
      for (const n of muts) (MUT[n] as (m: Record<string, unknown>) => void)(m);
      expect(checkPluginManifest(m).length === 0).toBe(muts.length === 0);
    }), propConfig);
  });

  it('accepts the shipped plugin.json', () => {
    expect(checkPluginManifest(JSON.parse(readFileSync(join(SKELETON_DIR, 'power', 'plugin.json'), 'utf8')))).toEqual([]);
  });

  it('rejects a non-object', () => { expect(checkPluginManifest([])).toHaveLength(1); });
});
