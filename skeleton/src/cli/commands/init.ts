// `golem init [dir] [--force]`: copy the Kiro pack into `.kiro/` and write a placeholder golem.config.json.
import { resolve } from '../paths.js';
import { buildPlan, executePlan, readManifest } from '../init.js';
import type { CommandHandler } from '../run.js';
import { line } from './common.js';

export const handler: CommandHandler = async (p, io, deps) => {
  const targetDir = p.positionals[0] !== undefined ? resolve(io.cwd, p.positionals[0]) : resolve(io.cwd, '.');
  const force = p.flags['force'] === true;
  const manifest = await readManifest(deps.fs, deps.packRoot);
  const plan = await buildPlan(deps.fs, targetDir, manifest, { force });
  await executePlan(deps.fs, plan, deps.packRoot, { force }, (s) => line(io, s));
  return 0;
};
