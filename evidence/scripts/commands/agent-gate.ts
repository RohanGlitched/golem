import { DRY_GOAL, FULL_GOAL, pickApp, runAgentGate } from '../agent-gate.js';
import { intFlag } from '../lib/args.js';
import { defaultResultsDir, gitCommit, repoRoot } from '../lib/meta.js';

type Flags = Record<string, string | true>;

export async function run(flags: Flags): Promise<void> {
  const dry = flags['dry-run'] === true;
  if (!dry && flags['approved'] !== true) {
    throw new Error('the full agent-gate experiment spends credits and needs the owner\'s approval: pass --approved. Use --dry-run for the N = 1 plumbing check.');
  }
  const out = typeof flags['out'] === 'string' ? (flags['out'] as string) : defaultResultsDir;
  const base = dry ? 'agent-gate.dryrun' : 'agent-gate';
  const extra = flags['trust-workspace'] === true ? ['--trust-workspace'] : [];
  await runAgentGate({
    repoRoot, appName: typeof flags['app'] === 'string' ? (flags['app'] as string) : pickApp(repoRoot),
    n: dry ? 1 : intFlag(flags, 'n', 6), cap: intFlag(flags, 'cap', 150),
    goal: typeof flags['goal'] === 'string' ? (flags['goal'] as string) : dry ? DRY_GOAL : FULL_GOAL,
    outPath: `${out}/${base}.jsonl`, streamDir: `${out}/${base}.streams`, dryRun: dry, extraKiroArgs: extra,
    log: (s) => console.log(s),
  }, gitCommit());
}

