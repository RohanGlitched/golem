import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ArgError, COMMANDS, GLOBAL_FLAGS, parseArgs, type CommandName } from '../args.js';
import { propConfig } from '../../../test/support/prop.js';

const names = Object.keys(COMMANDS) as CommandName[];
const word = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/);

function failure(args: string[]): ArgError {
  try { parseArgs(args); } catch (e) { return e as ArgError; }
  throw new Error(`expected a failure for ${JSON.stringify(args)}`);
}

describe('Property 2: argument errors name the culprit', () => {
  // Feature: golem-kit, Property 2: Argument errors name the culprit
  it('an unknown flag is named and every accepted flag is listed', () => {
    fc.assert(fc.property(fc.constantFrom(...names), word, fc.boolean(), (c, w, withValue) => {
      const flag = `zz${w}`;
      const spec = COMMANDS[c];
      const positionals = spec.positionals.filter((p) => p.required).map(() => 'x');
      const e = failure([c, ...positionals, withValue ? `--${flag}=1` : `--${flag}`]);
      expect(e.message).toContain(`--${flag}`);
      for (const f of [...spec.flags, ...GLOBAL_FLAGS]) expect(e.message).toContain(`--${f.name}`);
    }), propConfig);
  });

  it('a bad numeric value is named together with its flag', () => {
    const bad = fc.constantFrom('0', '-1', 'NaN', 'Infinity', '-Infinity', 'abc', '0x10', '1,5', ' ');
    const numeric = names.flatMap((c) => COMMANDS[c].flags.filter((f) => f.kind === 'posint' || f.kind === 'posnum').map((f) => [c, f.name] as const));
    fc.assert(fc.property(fc.constantFrom(...numeric), bad, fc.boolean(), ([c, flag], v, eq) => {
      const positionals = COMMANDS[c].positionals.filter((p) => p.required).map(() => 'x');
      const e = failure(eq ? [c, ...positionals, `--${flag}=${v}`] : [c, ...positionals, `--${flag}`, v]);
      expect(e.message).toContain(`--${flag}`);
      expect(e.message).toContain(v);
    }), propConfig);
  });

  it('a missing required positional shows the usage line', () => {
    fc.assert(fc.property(fc.constantFrom('falsify', 'replay' as CommandName), fc.boolean(), (c, json) => {
      const e = failure(json ? [c, '--json'] : [c]);
      expect(e.message).toContain(COMMANDS[c as CommandName].usage);
    }), propConfig);
  });

  it('a value flag without a value says a value is required and names the flag', () => {
    const valueFlags = names.flatMap((c) => [...COMMANDS[c].flags, ...GLOBAL_FLAGS].filter((f) => f.kind !== 'bool').map((f) => [c, f.name] as const));
    fc.assert(fc.property(fc.constantFrom(...valueFlags), fc.boolean(), ([c, flag], eq) => {
      const positionals = COMMANDS[c].positionals.filter((p) => p.required).map(() => 'x');
      const e = failure(eq ? [c, ...positionals, `--${flag}=`] : [c, ...positionals, `--${flag}`]);
      expect(e.message).toContain(`--${flag}`);
      expect(e.message).toContain('requires a value');
    }), propConfig);
  });

  it('an unknown command is named and the valid commands are listed', () => {
    fc.assert(fc.property(word.filter((w) => !names.includes(w as CommandName)), (w) => {
      const e = failure([w]);
      expect(e.message).toContain(`"${w}"`);
      for (const c of names) expect(e.message).toContain(c);
    }), propConfig);
  });

  it('a repeated flag and an extra positional are named', () => {
    fc.assert(fc.property(word, word, (a, b) => {
      expect(failure(['test', '--budget=3', '--budget=4']).message).toContain('--budget');
      expect(failure(['check', `f${a}`, `g${b}`]).message).toContain(`"g${b}"`);
    }), propConfig);
  });
});
