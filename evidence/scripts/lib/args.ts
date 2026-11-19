// Tiny flag parser: `--name value` and `--flag`.
export function parseFlags(argv: readonly string[]): { positionals: string[]; flags: Record<string, string | true> } {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[name] = next; i++; } else flags[name] = true;
    } else positionals.push(a);
  }
  return { positionals, flags };
}

export function intFlag(flags: Record<string, string | true>, name: string, dflt: number): number {
  const v = flags[name];
  if (v === undefined) return dflt;
  const n = typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isInteger(n)) throw new Error(`--${name} needs an integer`);
  return n;
}

export function listFlag(flags: Record<string, string | true>, name: string): string[] | undefined {
  const v = flags[name];
  return typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
}