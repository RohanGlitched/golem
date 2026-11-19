// In-process harness: `main(argv, io, deps)` over the Tiny_Test_App, a memory file system and fake pools.
import { main } from '../../src/cli/run.js';
import { APP_DIR, createTestDeps, createTestIo, seedTinyProject, type TestDeps, type TestDepsOptions, type TestIo } from './test-deps.js';
import { TINY_REQUIREMENTS } from './tiny-app.js';

export interface Harness extends TestDeps {
  io: TestIo;
  /** Runs `golem <args>` and returns the exit code. */
  run(...args: string[]): Promise<number>;
  /** Resets collected output. */
  clearOutput(): void;
  report(): any;
  path(rel: string): string;
}

/** A project in which requirement 1.2 breaks (200 N) and 1.1 and 1.3 hold. */
export const RED_REQUIREMENTS = TINY_REQUIREMENTS;
/** The same project with 1.2 fixed: every line holds. */
export const GREEN_REQUIREMENTS = TINY_REQUIREMENTS.replace('up to 200 N', 'up to 100 N');

export function createHarness(o: TestDepsOptions & { requirements?: string; seed?: boolean } = {}): Harness {
  const t = createTestDeps(o);
  if (o.seed !== false) seedTinyProject(t.fs, o.requirements ?? RED_REQUIREMENTS);
  const io = createTestIo(APP_DIR);
  const h: Harness = {
    ...t, io,
    run: (...args) => main(args, io, t.deps),
    clearOutput: () => { io.out.length = 0; io.err.length = 0; },
    report: () => { const x = t.fs.text(`${APP_DIR}/.golem/report.json`); return x === undefined ? undefined : JSON.parse(x); },
    path: (rel) => `${APP_DIR}/${rel}`,
  };
  return h;
}

export const stopPayload = (sessionId?: string): string => JSON.stringify({ hook_event_name: 'Stop', cwd: APP_DIR, ...(sessionId !== undefined ? { session_id: sessionId } : {}) });
