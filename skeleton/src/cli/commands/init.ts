// `golem init [dir] [--force] [--no-starter]`: copy the Kiro pack into `.kiro/`. A project with no robot also gets
// the starter cart-pole robot and a golem.config.json that points at it; otherwise the config is a placeholder.
import { resolve } from '../paths.js';
import { buildPlan, executePlan, readManifest, starterWritten } from '../init.js';
import type { CommandHandler } from '../run.js';
import { line } from './common.js';

export const handler: CommandHandler = async (p, io, deps) => {
  const targetDir = p.positionals[0] !== undefined ? resolve(io.cwd, p.positionals[0]) : resolve(io.cwd, '.');
  const force = p.flags['force'] === true;
  const starterRoot = p.flags['no-starter'] === true ? undefined : deps.starterRoot;
  const manifest = await readManifest(deps.fs, deps.packRoot);
  const plan = await buildPlan(deps.fs, targetDir, manifest, { force, ...(starterRoot !== undefined ? { starterRoot } : {}) });
  await executePlan(deps.fs, plan, deps.packRoot, { force }, (s) => line(io, s));
  if (starterWritten(plan)) line(io, 'next: npx --no-install golem-spec check');
  return 0;
};
