import { makeTestRequirement } from '../../../sim/index.js';
import { Announcer } from '../../core/announcer.js';
import { StudioStore } from '../../core/store.js';
import { PinnedSeedStore } from '../../run/pins.js';
import { RunController } from '../../run/run-controller.js';
import type { RunDeps } from '../../run/run-controller.js';
import { FakeClock, FakePool, FakeRaf, FakeStorage, fakeFalsify, synthResult } from '../fakes.js';
import type { FalsifyFn, LineModel, StudioState, TrialPool } from '../../types.js';

export function lineOf(id: string, maxForce = 200): LineModel {
  const compiled = makeTestRequirement({ horizon: 1, id, maxForce });
  return { id, original: compiled.source, text: compiled.source, diagnostics: [], compiled, status: 'untested', stale: false };
}

export function initialState(lines: LineModel[]): StudioState {
  return {
    lines, aura: { total: 0, ignored: 0, summary: 'No trials yet' }, theme: 'dark', reducedMotion: false, hero: 'loading',
    messages: [], stageFrames: 0, poolConfigured: true,
  };
}

export function runRig(opts: { falsify?: FalsifyFn; pool?: TrialPool; lines?: LineModel[]; storage?: FakeStorage; deps?: Partial<RunDeps> } = {}) {
  const raf = new FakeRaf();
  const clock = new FakeClock();
  const store = new StudioStore(initialState(opts.lines ?? [lineOf('1.1'), lineOf('1.2')]), { raf: raf.raf, caf: raf.caf });
  const polite = { textContent: '' as string | null }, alert = { textContent: '' as string | null };
  const announcer = new Announcer({ polite, alert });
  const storage = opts.storage ?? new FakeStorage();
  const pins = new PinnedSeedStore(storage, () => {});
  const pool = opts.pool ?? new FakePool((s) => synthResult(s));
  let auraWrites = 0;
  const rc = new RunController({
    appId: 'test', warmup: 0.2, store, pool, falsify: opts.falsify ?? fakeFalsify(10, 5), pins, announcer, now: clock.now,
    budget: { maxTrials: 240, maxMs: 30000 }, seed: 1, generationSize: 64, swarm: () => undefined,
    auraChanged: () => { auraWrites++; }, ...opts.deps,
  });
  const line = (id: string) => store.getState().lines.find((l) => l.id === id)!;
  return { rc, store, pool, pins, storage, polite, alert, clock, line, auraWrites: () => auraWrites };
}
