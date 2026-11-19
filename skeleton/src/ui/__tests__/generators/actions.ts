import { compileRequirement } from '../../../ears/index.js';
import { StudioStore } from '../../core/store.js';
import type { StudioActions } from '../../tablet/actions.js';
import type { LineModel, StudioState } from '../../types.js';
import { testLexicon } from './lexicon.js';
import { initialState } from './run.js';

export function compiledLine(id: string, text: string, group?: string): LineModel {
  const r = compileRequirement(text, testLexicon, { id });
  return {
    id, original: text, text, diagnostics: r.diagnostics, ...(r.requirement ? { compiled: r.requirement } : {}),
    status: r.diagnostics.some((d) => d.severity === 'error') ? 'error' : 'untested', stale: false, ...(group ? { group } : {}),
  };
}

/** A store that notifies synchronously, for Testing Library. */
export function syncStore(state: Partial<StudioState> & { lines: LineModel[] }): StudioStore {
  return new StudioStore({ ...initialState(state.lines), ...state }, { raf: (cb) => { queueMicrotask(cb); return 1; }, caf: () => {} });
}

export function fakeActions(over: Partial<StudioActions> = {}): StudioActions & { calls: string[] } {
  const calls: string[] = [];
  const log = (name: string) => (...a: unknown[]) => { calls.push(`${name}(${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')})`); };
  return {
    calls,
    summon: log('summon'), summonAll: log('summonAll'), stop: log('stop'), select: log('select'),
    compile: (id, text) => compileRequirement(text, testLexicon, { id }),
    commitLine: log('commitLine'), reset: log('reset'), toggleTheme: log('toggleTheme'),
    replay: log('replay'), backToLive: log('backToLive'), play: log('play'), pause: log('pause'),
    seekTime: log('seekTime'), stepFrame: log('stepFrame'),
    copySeed: async () => true, pin: log('pin'), removePin: log('removePin'), pinsOf: () => [],
    ...over,
  };
}
