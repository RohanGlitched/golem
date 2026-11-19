import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { COMMANDS, GLOBAL_FLAGS, formatArgs, parseArgs, type CommandName, type ParsedCommand } from '../args.js';
import { propConfig } from '../../../test/support/prop.js';

const str = fc.string({ minLength: 1, maxLength: 12 });
const positional = fc.oneof(str, fc.constantFrom('--x', '--', '--budget', '-v', '--a=b'), str.map((s) => `--${s}`));

const arbCommand: fc.Arbitrary<ParsedCommand> = fc.constantFrom(...(Object.keys(COMMANDS) as CommandName[])).chain((name) => {
  const spec = COMMANDS[name];
  const flagArbs = [...spec.flags, ...GLOBAL_FLAGS].map((f) => {
    const value: fc.Arbitrary<string | number | true> =
      f.kind === 'bool' ? fc.constant(true as const)
        : f.kind === 'string' ? str
          : f.kind === 'posint' ? fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER })
            : fc.double({ min: 1e-6, max: 1e9, noNaN: true });
    return fc.option(value, { nil: undefined }).map((v) => [f.name, v] as const);
  });
  const required = spec.positionals.filter((q) => q.required).length;
  return fc.record({
    flags: fc.tuple(...flagArbs),
    positionals: fc.array(positional, { minLength: required, maxLength: spec.positionals.length }),
  }).map(({ flags, positionals }) => ({
    command: name,
    positionals,
    flags: Object.fromEntries(flags.filter(([, v]) => v !== undefined)) as Record<string, string | number | true>,
  }));
});

describe('Property 1: argument parse and format round trip', () => {
  // Feature: golem-kit, Property 1: Argument parse and format round trip
  it('parses a formatted command back to an equal command', () => {
    fc.assert(fc.property(arbCommand, (c) => {
      const back = parseArgs(formatArgs(c));
      // help is a valid flag; with it the parser returns { help: true } by design
      if (c.flags['help'] === true) { expect(back).toEqual({ help: true }); return; }
      expect(back).toEqual(c);
    }), propConfig);
  });

  it('formats then parses to the same arguments again', () => {
    fc.assert(fc.property(arbCommand, (c) => {
      fc.pre(c.flags['help'] !== true);
      const once = formatArgs(c);
      expect(formatArgs(parseArgs(once) as ParsedCommand)).toEqual(once);
    }), propConfig);
  });
});
