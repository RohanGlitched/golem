import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateInput } from '../schema.js';
import { TOOL_NAMES, TOOL_SCHEMAS, type ToolName } from '../tool-schemas.js';
import { propConfig } from '../../../test/support/prop.js';

/** A bad value for one property, by its schema. */
function badValue(p: (typeof TOOL_SCHEMAS)[ToolName]['properties'][string]): fc.Arbitrary<unknown> {
  if (p.type === 'integer') {
    return fc.oneof(
      fc.integer({ max: (p.minimum ?? 0) - 1 }), fc.integer({ min: (p.maximum ?? 1000) + 1, max: (p.maximum ?? 1000) + 1000000 }),
      fc.double({ noInteger: true, noNaN: true, noDefaultInfinity: true }).filter((x) => !Number.isInteger(x)),
      fc.string(), fc.constant(null), fc.boolean(),
    );
  }
  return fc.oneof(
    fc.integer(), fc.constant(null), fc.boolean(), fc.array(fc.string(), { maxLength: 2 }),
    ...(p.minLength !== undefined && p.minLength > 0 ? [fc.constant('')] : []),
    fc.string({ minLength: (p.maxLength ?? 100) + 1, maxLength: (p.maxLength ?? 100) + 5 }),
  );
}

const withProps = TOOL_NAMES.filter((n) => Object.keys(TOOL_SCHEMAS[n].properties).length > 0);

describe('Property 30: tool input validation names the field', () => {
  // Feature: golem-kit, Property 30: Tool input validation names the field
  it('rejects an invalid field with ok false and its name, and a handler behind it is never called', () => {
    fc.assert(fc.property(fc.constantFrom(...withProps), fc.nat(), fc.nat(), (name, i, j) => {
      const schema = TOOL_SCHEMAS[name];
      const fields = Object.keys(schema.properties);
      const field = fields[i % fields.length] as string;
      const good: Record<string, unknown> = {};
      for (const f of schema.required ?? []) good[f] = (schema.properties[f] as { type: string }).type === 'integer' ? 1 : 'x';
      const [bad] = fc.sample(badValue(schema.properties[field] as never), { numRuns: 1, seed: j });
      let called = false;
      const handler = (): void => { called = true; };
      const r = validateInput(schema, { ...good, [field]: bad });
      if (r.ok) handler();
      expect(r.ok).toBe(false);
      expect((r as { field: string }).field).toBe(field);
      expect((r as { message: string }).message).toContain(field);
      expect(called).toBe(false);
    }), propConfig);
  });

  it('rejects an unknown key by name for every tool', () => {
    fc.assert(fc.property(fc.constantFrom(...TOOL_NAMES), fc.stringMatching(/^zz[a-z]{1,6}$/), (name, key) => {
      const schema = TOOL_SCHEMAS[name];
      const good: Record<string, unknown> = {};
      for (const f of schema.required ?? []) good[f] = (schema.properties[f] as { type: string }).type === 'integer' ? 1 : 'x';
      expect(validateInput(schema, { ...good, [key]: 1 })).toMatchObject({ ok: false, field: key });
    }), propConfig);
  });

  it('gives valid arguments their defaults', () => {
    fc.assert(fc.property(fc.constantFrom('run_requirement' as const, 'falsify' as const), fc.string({ minLength: 1, maxLength: 20 }), (name, reqId) => {
      expect(validateInput(TOOL_SCHEMAS[name], { reqId })).toEqual({ ok: true, value: { reqId, budget: 24 } });
    }), propConfig);
  });
});
