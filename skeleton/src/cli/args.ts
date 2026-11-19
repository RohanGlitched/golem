// Arg_Parser and Arg_Formatter: small, hand written, no dependency.
export type FlagKind = 'bool' | 'string' | 'posint' | 'posnum';
export interface FlagSpec { name: string; kind: FlagKind }
export type CommandName = 'check' | 'test' | 'falsify' | 'replay' | 'gate' | 'init' | 'mcp';

export interface CommandSpec {
  name: CommandName;
  /** One line, shown when a required positional is missing. */
  usage: string;
  positionals: { name: string; required: boolean }[];
  /** Command flags in formatting order; global flags are added by the parser. */
  flags: FlagSpec[];
}

export const GLOBAL_FLAGS: FlagSpec[] = [
  { name: 'app', kind: 'string' },
  { name: 'json', kind: 'bool' },
  { name: 'help', kind: 'bool' },
];

const budgetFlags: FlagSpec[] = [
  { name: 'budget', kind: 'posint' },
  { name: 'time', kind: 'posnum' },
  { name: 'workers', kind: 'posint' },
  { name: 'search-seed', kind: 'posint' },
];

export const COMMANDS: Record<CommandName, CommandSpec> = {
  check: {
    name: 'check', usage: 'npx golem-spec check [file] [--app <dir>] [--json]',
    positionals: [{ name: 'file', required: false }], flags: [],
  },
  test: {
    name: 'test', usage: 'npx golem-spec test [--req <id>] [--budget <n>] [--time <s>] [--workers <n>] [--search-seed <n>] [--app <dir>] [--json]',
    positionals: [], flags: [{ name: 'req', kind: 'string' }, ...budgetFlags],
  },
  falsify: {
    name: 'falsify', usage: 'npx golem-spec falsify <reqId> [--budget <n>] [--time <s>] [--workers <n>] [--search-seed <n>] [--app <dir>] [--json]',
    positionals: [{ name: 'reqId', required: true }], flags: [...budgetFlags],
  },
  replay: {
    name: 'replay', usage: 'npx golem-spec replay <reqId> [--seed <n>] [--app <dir>] [--json]',
    positionals: [{ name: 'reqId', required: true }], flags: [{ name: 'seed', kind: 'posint' }],
  },
  gate: {
    name: 'gate', usage: 'npx golem-spec gate [--kiro] [--budget <n>] [--time <s>] [--workers <n>] [--search-seed <n>] [--app <dir>] [--json]',
    positionals: [], flags: [{ name: 'kiro', kind: 'bool' }, ...budgetFlags],
  },
  init: {
    name: 'init', usage: 'npx golem-spec init [dir] [--force] [--no-starter]',
    positionals: [{ name: 'dir', required: false }], flags: [{ name: 'force', kind: 'bool' }, { name: 'no-starter', kind: 'bool' }],
  },
  mcp: { name: 'mcp', usage: 'npx golem-spec mcp [--app <dir>]', positionals: [], flags: [] },
};

export const COMMAND_NAMES = Object.keys(COMMANDS) as CommandName[];

export interface ParsedCommand {
  command: CommandName;
  positionals: string[];
  /** Keyed by the flag name without the leading dashes. Numbers are already parsed. */
  flags: Record<string, string | number | true>;
}

export class ArgError extends Error {
  override name = 'ArgError';
  constructor(message: string, readonly flag?: string, readonly value?: string) { super(message); }
}

export function usageText(): string {
  const lines = ['usage: golem <command> [options]', '', 'commands:'];
  for (const c of COMMAND_NAMES) lines.push(`  ${COMMANDS[c].usage}`);
  lines.push('', 'global flags: --app <dir>, --json, --help');
  return `${lines.join('\n')}\n`;
}

const allFlags = (c: CommandSpec): FlagSpec[] => [...c.flags, ...GLOBAL_FLAGS];
const flagList = (c: CommandSpec): string => allFlags(c).map((f) => `--${f.name}`).join(', ');

const DECIMAL = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function convert(spec: FlagSpec, raw: string): string | number {
  if (spec.kind === 'string') return raw;
  const bad = new ArgError(`flag --${spec.name} needs a positive ${spec.kind === 'posint' ? 'integer' : 'number'}, got "${raw}"`, `--${spec.name}`, raw);
  if (spec.kind === 'posint') {
    if (!/^\d+$/.test(raw)) throw bad;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n <= 0) throw bad;
    return n;
  }
  if (!DECIMAL.test(raw)) throw bad;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw bad;
  return n;
}

export function parseArgs(argv: readonly string[]): ParsedCommand | { help: true } {
  // Pass 1: find the command name. Global value flags before it consume their value.
  let command: CommandName | undefined;
  let commandText: string | undefined;
  const rest: string[] = [];
  let i = 0;
  let sawDashDash = false;
  for (; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--') { sawDashDash = true; break; }
    if (a.startsWith('--')) {
      rest.push(a);
      const name = a.slice(2).split('=')[0] as string;
      const g = GLOBAL_FLAGS.find((f) => f.name === name);
      if (g !== undefined && g.kind !== 'bool' && !a.includes('=') && i + 1 < argv.length) rest.push(argv[++i] as string);
      continue;
    }
    commandText = a;
    i++;
    break;
  }
  const tail = argv.slice(i);
  if (sawDashDash) tail.unshift('--');
  const helpEarly = rest.includes('--help');
  if (commandText !== undefined && (COMMAND_NAMES as string[]).includes(commandText)) command = commandText as CommandName;
  if (command === undefined) {
    if (helpEarly || tail.includes('--help')) return { help: true };
    const valid = COMMAND_NAMES.join(', ');
    throw new ArgError(
      commandText === undefined ? `no command given; valid commands: ${valid}` : `unknown command "${commandText}"; valid commands: ${valid}`,
      undefined, commandText,
    );
  }
  const spec = COMMANDS[command];
  const flags: Record<string, string | number | true> = {};
  const positionals: string[] = [];
  const handle = (tokens: readonly string[], allowPositional: boolean): void => {
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k] as string;
      if (t === '--') {
        for (const p of tokens.slice(k + 1)) positionals.push(p);
        return;
      }
      if (!t.startsWith('--')) {
        if (!allowPositional) throw new ArgError(`unexpected argument "${t}"`, undefined, t);
        positionals.push(t);
        continue;
      }
      const eq = t.indexOf('=');
      const name = eq < 0 ? t.slice(2) : t.slice(2, eq);
      const fs = allFlags(spec).find((f) => f.name === name);
      if (fs === undefined) throw new ArgError(`unknown flag --${name} for "${command}"; accepted flags: ${flagList(spec)}`, `--${name}`);
      if (Object.prototype.hasOwnProperty.call(flags, name)) throw new ArgError(`flag --${name} given more than once`, `--${name}`);
      if (fs.kind === 'bool') {
        if (eq >= 0) throw new ArgError(`flag --${name} takes no value, got "${t.slice(eq + 1)}"`, `--${name}`, t.slice(eq + 1));
        flags[name] = true;
        continue;
      }
      let raw: string | undefined;
      if (eq >= 0) raw = t.slice(eq + 1);
      else if (k + 1 < tokens.length) raw = tokens[++k] as string;
      if (raw === undefined || raw === '') throw new ArgError(`flag --${name} requires a value`, `--${name}`);
      flags[name] = convert(fs, raw);
    }
  };
  handle([...rest, ...tail], true);
  if (flags['help'] === true) return { help: true };
  const max = spec.positionals.length;
  if (positionals.length > max) {
    const extra = positionals[max] as string;
    throw new ArgError(`unexpected argument "${extra}"; usage: ${spec.usage}`, undefined, extra);
  }
  const need = spec.positionals.filter((p) => p.required).length;
  if (positionals.length < need) {
    throw new ArgError(`missing <${(spec.positionals[positionals.length] as { name: string }).name}>; usage: ${spec.usage}`);
  }
  return { command, positionals, flags };
}

export function formatArgs(cmd: ParsedCommand): string[] {
  const spec = COMMANDS[cmd.command];
  const out: string[] = [cmd.command];
  for (const f of allFlags(spec)) {
    const v = cmd.flags[f.name];
    if (v === undefined) continue;
    out.push(f.kind === 'bool' ? `--${f.name}` : `--${f.name}=${String(v)}`);
  }
  if (cmd.positionals.some((p) => p.startsWith('--'))) out.push('--');
  out.push(...cmd.positionals);
  return out;
}
