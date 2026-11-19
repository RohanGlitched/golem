// The real engine through its public entries: app loading, requirement compiling and the Node worker pool.
import { readFile } from 'node:fs/promises';
import { createDefaultDeps, locateApp } from 'golem-spec/node';
import type { CompiledRequirement, TrialPool } from 'golem-spec';
import type { KitDeps } from 'golem-spec/node';

type RobotApp = Awaited<ReturnType<KitDeps['loadApp']>>;

export interface Engine {
  appDir: string;
  app: RobotApp;
  requirements: CompiledRequirement[];
  pool: TrialPool;
  /** Text of each requirements file, by path. */
  texts: Record<string, string>;
  close(): Promise<void>;
}

export const slash = (p: string): string => p.replace(/\\/g, '/');

/** Loads the app in `appDir` (it needs a golem.config.json) and starts a pool. `requirementFiles` replaces the config's list. */
export async function openEngine(appDir: string, opts: { requirementFiles?: string[]; size?: number } = {}): Promise<Engine> {
  const deps = createDefaultDeps();
  const located = await locateApp(slash(appDir), slash(appDir), deps.fs);
  const robotApp = await deps.loadApp(located.config.app);
  const files = opts.requirementFiles?.map(slash) ?? located.config.requirements;
  const requirements: CompiledRequirement[] = [];
  const texts: Record<string, string> = {};
  for (const f of files) {
    texts[f] = await readFile(f, 'utf8');
    const r = deps.compileFile(texts[f], robotApp.lexicon);
    const errs = r.diagnostics.filter((d) => d.severity === 'error');
    if (errs.length > 0) throw new Error(`${f}: ${errs.map((e) => e.message).join('; ')}`);
    requirements.push(...(r.requirements as CompiledRequirement[]));
  }
  const pool = await deps.createPool({ app: robotApp, appDir: located.appDir, requirementFiles: files, ...(opts.size !== undefined ? { size: opts.size } : {}) });
  return {
    appDir: located.appDir, app: robotApp, requirements, pool, texts,
    async close() {
      await pool.close();
      await deps.dispose?.();
    },
  };
}