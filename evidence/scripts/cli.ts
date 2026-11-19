// Entry: vite-node scripts/cli.ts -- <falsifier|map-g1|agent-gate|report> [flags]
import { parseFlags } from './lib/args.js';

const COMMANDS = ['falsifier', 'map-g1', 'agent-gate', 'report'] as const;

async function main(): Promise<void> {
  const { positionals, flags } = parseFlags(process.argv.slice(2).filter((a) => a !== '--'));
  const name = positionals[0];
  if (!COMMANDS.includes(name as (typeof COMMANDS)[number])) {
    console.error(`usage: cli.ts <${COMMANDS.join('|')}> [flags]`);
    process.exitCode = 1;
    return;
  }
  const mod = (await import(/* @vite-ignore */ `./commands/${name}.js`)) as { run(flags: Record<string, string | true>): void | Promise<void> };
  await mod.run(flags);
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });