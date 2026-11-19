import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanUrls } from '../scripts/pack-checks/power.js';
import { readTree } from '../scripts/sync-power.js';
import { SKELETON_DIR } from './support/pack.js';
import { propConfig } from './support/prop.js';

const host = fc.stringMatching(/^[a-z]{2,8}\.(com|org|dev)$/);
const url = fc.tuple(fc.constantFrom('http', 'https', 'ftp', 'ws'), host, fc.stringMatching(/^[a-z]{0,6}$/)).map(([s, h, p]) => `${s}://${h}/${p}`);
const ip = fc.tuple(...[0, 1, 2, 3].map(() => fc.integer({ min: 0, max: 255 }))).map((x) => x.join('.'));
const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';

describe('Property 48: URL scan allows only the $schema keys', () => {
  // Feature: golem-kit, Property 48: URL scan allows only the $schema keys
  it('reports each URL, command URL and IP address outside the two $schema values, and none inside', () => {
    fc.assert(fc.property(fc.array(url, { maxLength: 3 }), fc.array(ip, { maxLength: 3 }), fc.constantFrom('plugin.json', 'mcp.json'), fc.boolean(), (urls, ips, base, withSchema) => {
      const doc: Record<string, unknown> = { name: 'x', ...(withSchema ? { $schema: SCHEMA } : {}), notes: urls, hosts: ips, command: urls[0] ?? 'npx' };
      const found = scanUrls([{ path: base, text: JSON.stringify(doc) }]);
      const expectedUrls = urls.length + (urls.length > 0 ? 1 : 0);
      expect(found.filter((f) => f.includes(': URL ')).length).toBe(expectedUrls);
      expect(found.filter((f) => f.includes(': IP address ')).length).toBe(ips.length);
      expect(found.some((f) => f.includes('agent-plugins.org'))).toBe(false);
    }), propConfig);
  });

  it('reports a URL in a nested file or in another JSON file even under a $schema key', () => {
    expect(scanUrls([{ path: 'skills/a/SKILL.md', text: 'see https://x.dev/a' }])).toHaveLength(1);
    expect(scanUrls([{ path: 'other.json', text: JSON.stringify({ $schema: SCHEMA }) }])).toHaveLength(1);
    expect(scanUrls([{ path: 'steering/plugin.json', text: JSON.stringify({ $schema: SCHEMA }) }])).toHaveLength(1);
  });

  it('exempts only the licence text', () => {
    expect(scanUrls([{ path: 'LICENSE', text: 'http://www.apache.org/licenses/' }])).toEqual([]);
  });

  it('gives no finding for the shipped Power', () => {
    const power = join(SKELETON_DIR, 'power');
    expect(scanUrls([...readTree(power).keys()].map((p) => ({ path: p, text: readFileSync(join(power, p), 'utf8') })))).toEqual([]);
  });
});
