import { describe, expect, it } from 'vitest';
import { ArgError, COMMANDS, formatArgs, parseArgs, usageText } from '../args.js';

const p = (...a: string[]) => parseArgs(a);
const fail = (...a: string[]): ArgError => {
  try { parseArgs(a); } catch (e) { return e as ArgError; }
  throw new Error('expected a failure');
};

describe('parseArgs', () => {
  it('parses --flag value and --flag=value to the same command', () => {
    const a = p('test', '--budget', '24', '--req=R3');
    expect(a).toEqual(p('test', '--req', 'R3', '--budget=24'));
    expect(a).toEqual({ command: 'test', positionals: [], flags: { budget: 24, req: 'R3' } });
  });

  it('accepts global flags before and after the command name', () => {
    expect(p('--json', '--app', 'x', 'check')).toEqual(p('check', '--app=x', '--json'));
  });

  it('returns help for --help without checking positionals', () => {
    expect(p('falsify', '--help')).toEqual({ help: true });
    expect(p('--help')).toEqual({ help: true });
    expect(p('nonsense', '--help')).toEqual({ help: true });
  });

  it('treats everything after -- as positional and drops the --', () => {
    expect(p('falsify', '--', '--budget')).toEqual({ command: 'falsify', positionals: ['--budget'], flags: {} });
    expect(p('check', '--json', '--', '--')).toEqual({ command: 'check', positionals: ['--'], flags: { json: true } });
  });

  it('takes the text after the first = as the value', () => {
    expect(p('test', '--req=a=b')).toMatchObject({ flags: { req: 'a=b' } });
  });

  it('lists every accepted flag for an unknown flag', () => {
    const e = fail('test', '--bogus');
    expect(e.message).toContain('--bogus');
    for (const f of ['--req', '--budget', '--time', '--workers', '--search-seed', '--app', '--json', '--help']) expect(e.message).toContain(f);
  });

  it.each(['0', '-1', 'NaN', 'Infinity', 'abc', '1.5'])('rejects %s as a --budget value and names flag and value', (v) => {
    const e = fail('test', '--budget', v);
    expect(e.message).toContain('--budget');
    expect(e.message).toContain(`"${v}"`);
  });

  it('accepts a positive decimal for --time and rejects a non-positive one', () => {
    expect(p('test', '--time=0.5')).toMatchObject({ flags: { time: 0.5 } });
    expect(fail('test', '--time=0').message).toContain('--time');
  });

  it('shows the usage line when a required positional is missing', () => {
    expect(fail('falsify').message).toContain(COMMANDS.falsify.usage);
    expect(fail('replay', '--seed', '3').message).toContain('npx golem-spec replay <reqId>');
  });

  it('says a value is required for a last or empty value flag', () => {
    expect(fail('test', '--req').message).toContain('requires a value');
    expect(fail('test', '--req=').message).toContain('--req');
  });

  it('lists the valid commands for an unknown or missing command', () => {
    expect(fail('frobnicate').message).toContain('"frobnicate"');
    expect(fail('frobnicate').message).toContain('check, test, falsify, replay, gate, init, mcp');
    expect(fail().message).toContain('no command given');
    expect(fail('--json').message).toContain('valid commands');
  });

  it('names a repeated flag and the first extra positional', () => {
    expect(fail('test', '--budget=1', '--budget=2').message).toContain('--budget');
    expect(fail('check', 'a.md', 'b.md').message).toContain('"b.md"');
  });

  it('rejects a value on a boolean flag', () => {
    expect(fail('gate', '--kiro=yes').message).toContain('--kiro');
  });
});

describe('formatArgs', () => {
  it('writes value flags as --flag=value and puts -- before a positional that starts with --', () => {
    const args = formatArgs({ command: 'falsify', positionals: ['--odd'], flags: { budget: 8, json: true } });
    expect(args).toEqual(['falsify', '--budget=8', '--json', '--', '--odd']);
  });

  it('prints one usage line per command in the usage text', () => {
    const t = usageText();
    for (const c of Object.values(COMMANDS)) expect(t).toContain(c.usage);
  });
});
