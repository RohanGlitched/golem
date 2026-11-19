import { describe, expect, it } from 'vitest';
import { validateInput } from '../schema.js';
import { TOOL_NAMES, TOOL_SCHEMAS } from '../tool-schemas.js';

const run = TOOL_SCHEMAS.run_requirement;

describe('validateInput', () => {
  it('applies the default budget of 24', () => {
    expect(validateInput(run, { reqId: 'R1' })).toEqual({ ok: true, value: { reqId: 'R1', budget: 24 } });
  });

  it.each([0, 1025, 1.5, '24', null])('rejects budget %j and names the field and the range 1 to 1024', (b) => {
    const r = validateInput(run, { reqId: 'R1', budget: b });
    expect(r).toMatchObject({ ok: false, field: 'budget' });
    expect((r as { message: string }).message).toContain('1 to 1024');
  });

  it('accepts the limits 1 and 1024', () => {
    expect(validateInput(run, { reqId: 'R1', budget: 1 }).ok).toBe(true);
    expect(validateInput(run, { reqId: 'R1', budget: 1024 }).ok).toBe(true);
  });

  it('rejects an unknown key and a missing required field, naming them', () => {
    expect(validateInput(run, { reqId: 'R1', extra: 1 })).toMatchObject({ ok: false, field: 'extra' });
    expect(validateInput(run, {})).toMatchObject({ ok: false, field: 'reqId' });
  });

  it('checks text and rationale length limits', () => {
    const p = TOOL_SCHEMAS.propose_requirement;
    expect(validateInput(p, { text: '' })).toMatchObject({ ok: false, field: 'text' });
    expect(validateInput(p, { text: 'x'.repeat(1001) })).toMatchObject({ ok: false, field: 'text' });
    expect(validateInput(p, { text: 'x', rationale: 'y'.repeat(1001) })).toMatchObject({ ok: false, field: 'rationale' });
    expect(validateInput(p, { text: 'x', rationale: '' }).ok).toBe(true);
    expect(validateInput(TOOL_SCHEMAS.check_requirement, { text: 'x'.repeat(2001) })).toMatchObject({ ok: false, field: 'text' });
  });

  it('accepts no arguments for list_requirements and rejects a non-object', () => {
    expect(validateInput(TOOL_SCHEMAS.list_requirements, undefined)).toEqual({ ok: true, value: {} });
    expect(validateInput(TOOL_SCHEMAS.list_requirements, [])).toMatchObject({ ok: false });
  });

  it('has a schema for each of the eight tools', () => {
    expect([...TOOL_NAMES]).toHaveLength(8);
    for (const n of TOOL_NAMES) expect(TOOL_SCHEMAS[n].additionalProperties).toBe(false);
  });
});
