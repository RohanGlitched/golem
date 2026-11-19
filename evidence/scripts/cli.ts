// Entry: vite-node scripts/cli.ts -- <falsifier|map-g1|agent-gate|report> [flags]
import { parseFlags } from './lib/args.js';

type Command = { run(flags: Record<string, string | true>): void | Promise<void> };

const COMMANDS: Record<string, () => Promise<Command>> = {
  falsifier: () => import('./commands/falsifier.js'),
  'map-g1': () => import('./commands/map-g1.js'),
  'agent-gate': () => import('./commands/agent-gate.js'),
  report: () => import('./commands/report.js'),
};

async function main(): Promise<void> {
  const { positionals, flags } = parseFlags(process.argv.slice(2).filter((a) => a !== '--'));
  const name = positionals[0];
  const load = name === undefined ? undefined : COMMANDS[name];
  if (!load) {
    console.error(`usage: cli.ts <${Object.keys(COMMANDS).join('|')}> [flags]`);
    process.exitCode = 1;
    return;
  }
  await (await load()).run(flags);
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });