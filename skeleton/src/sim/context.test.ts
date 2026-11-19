import { describe, expect, it } from 'vitest';
import { buildContext } from './context.js';
import { SimError } from './errors.js';
import { FAKE_OBJ, withFakeMj } from './test-fixtures.js';

const setup = () => {
  const f = withFakeMj();
  f.names[FAKE_OBJ.body] = ['pelvis', 'torso'];
  f.names[FAKE_OBJ.joint] = ['hip'];
  const model = {};
  const data = {};
  return { f, model, data };
};

describe('buildContext', () => {
  it('fills ids as <type>:<name> within range', () => {
    const { f, model, data } = setup();
    const ctx = buildContext(f.mj, model, data, { body: ['pelvis', 'torso'], joint: ['hip'] });
    expect(ctx.ids).toEqual({ 'body:pelvis': 0, 'body:torso': 1, 'joint:hip': 0 });
  });
  it('gives the same id when a name is looked up twice', () => {
    const { f, model, data } = setup();
    const ctx = buildContext(f.mj, model, data);
    expect(ctx.lookup.body('torso')).toBe(ctx.lookup.body('torso'));
  });
  it('throws on an empty name without calling mj_name2id', () => {
    const { f, model, data } = setup();
    expect(() => buildContext(f.mj, model, data, { body: [''] })).toThrow(SimError);
    expect(f.calls.name2id).toEqual([]);
  });
  it('throws on a name of the wrong type and names the requested type', () => {
    const { f, model, data } = setup();
    expect(() => buildContext(f.mj, model, data, { joint: ['pelvis'] })).toThrow(/joint named "pelvis"/);
  });
  it('throws on an unknown declared name and returns no context', () => {
    const { f, model, data } = setup();
    expect(() => buildContext(f.mj, model, data, { body: ['pelvis', 'ghost'] })).toThrow(/body named "ghost"/);
  });
  it('returns the same mj, model and data references', () => {
    const { f, model, data } = setup();
    const ctx = buildContext(f.mj, model, data);
    expect(ctx.mj).toBe(f.mj);
    expect(ctx.model).toBe(model);
    expect(ctx.data).toBe(data);
  });
  it('passes the enum value to mj_name2id', () => {
    const { f, model, data } = setup();
    buildContext(f.mj, model, data, { body: ['pelvis'] });
    expect(f.calls.name2id).toEqual([[FAKE_OBJ.body, 'pelvis']]);
  });
});
