// `main(argv, io, deps)`: the only entry point (design D1). It never throws: every error becomes `golem: <message>` and 1.
import { parseArgs, usageText, type CommandName, type ParsedCommand } from './args.js';
import type { CliIo, KitDeps } from './deps.js';

export type CommandHandler = (p: ParsedCommand, io: CliIo, deps: KitDeps) => Promise<number>;

/** Loads `commands/<name>.ts` on demand. `gate --kiro` uses its own handler (the two output protocols, D10). */
export async function loadHandler(p: ParsedCommand): Promise<CommandHandler> {
  const name: CommandName = p.command;
  switch (name) {
    case 'check': return (await import('./commands/check.js')).handler;
    case 'test': return (await import('./commands/test.js')).handler;
    case 'falsify': return (await import('./commands/falsify.js')).handler;
    case 'replay': return (await import('./commands/replay.js')).handler;
    case 'gate': return p.flags['kiro'] === true ? (await import('./commands/gate-kiro.js')).handler : (await import('./commands/gate.js')).handler;
    case 'init': return (await import('./commands/init.js')).handler;
    case 'mcp': return (await import('./commands/mcp.js')).handler;
  }
}

export async function main(argv: readonly string[], io: CliIo, deps: KitDeps): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if ('help' in parsed) {
      io.stdout.write(usageText());
      return 0;
    }
    return await (await loadHandler(parsed))(parsed, io, deps);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    io.stderr.write(`golem: ${msg}\n`);
    return 1;
  } finally {
    try { await deps.dispose?.(); } catch { /* releasing caches must not change the exit code */ }
  }
}
