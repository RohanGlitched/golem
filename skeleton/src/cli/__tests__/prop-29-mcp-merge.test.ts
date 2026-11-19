import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mergeMcpSettings } from '../init.js';
import { MCP_TEMPLATE } from '../../../test/support/pack-fixture.js';
import { propConfig } from '../../../test/support/prop.js';

const GOLEM = { command: 'golem', args: ['mcp'] };
const server = fc.record({ command: fc.string({ minLength: 1, maxLength: 8 }), args: fc.array(fc.string({ maxLength: 5 }), { maxLength: 3 }) });
const name = fc.stringMatching(/^[a-z]{1,6}$/).filter((n) => n !== 'golem');
const arbSettings = fc.record({
  servers: fc.dictionary(name, server, { maxKeys: 4 }),
  golem: fc.option(server, { nil: undefined }),
  extra: fc.dictionary(fc.stringMatching(/^x[a-z]{1,5}$/), fc.jsonValue(), { maxKeys: 3 }),
});

const build = (s: { servers: Record<string, unknown>; golem: unknown; extra: Record<string, unknown> }): string =>
  JSON.stringify({ ...s.extra, mcpServers: { ...s.servers, ...(s.golem !== undefined ? { golem: s.golem } : {}) } }, null, 2);

describe('Property 29: MCP settings merge preserves other servers and top-level fields', () => {
  // Feature: golem-kit, Property 29: MCP settings merge preserves other servers and top-level fields
  it('keeps other servers and fields deeply equal, adds golem, and merging twice gives the same text', () => {
    fc.assert(fc.property(arbSettings, fc.boolean(), (s, force) => {
      const existing = build(s);
      const r = mergeMcpSettings(existing, MCP_TEMPLATE, force);
      const out = JSON.parse(r.text) as { mcpServers: Record<string, unknown> } & Record<string, unknown>;
      for (const [k, v] of Object.entries(s.servers)) expect(out.mcpServers[k]).toEqual(v);
      for (const [k, v] of Object.entries(s.extra)) expect(out[k]).toEqual(v);
      expect(out.mcpServers['golem']).toEqual(s.golem !== undefined && !force ? s.golem : GOLEM);
      expect(mergeMcpSettings(r.text, MCP_TEMPLATE, force).text).toBe(r.text);
      expect(mergeMcpSettings(r.text, MCP_TEMPLATE, false).text).toBe(r.text);
    }), propConfig);
  });

  it('leaves an existing golem entry unchanged unless force is given', () => {
    fc.assert(fc.property(arbSettings.filter((s) => s.golem !== undefined), (s) => {
      const existing = build(s);
      expect(mergeMcpSettings(existing, MCP_TEMPLATE, false)).toEqual({ text: existing, outcome: 'kept' });
      expect(mergeMcpSettings(existing, MCP_TEMPLATE, true).outcome).toBe('replaced');
    }), propConfig);
  });
});
