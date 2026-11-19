// The Tablet: requirement lines in file order, grouped under their Kiro requirement headings.
import type { LineModel } from '../types.js';
import type { StoreLike, StudioActions } from './actions.js';
import { useStudio } from './actions.js';
import { RequirementLine, STOP_LABEL } from './requirement-line.js';

export const EMPTY_TEXT = "No requirements found: add lines such as 'WHEN …, THE robot SHALL …' to your requirements.md";
export const NO_POOL_TEXT = 'No trial pool is configured: pass `pool` or `workerUrl` to mountStudio';
export const SUMMON_ALL_LABEL = 'Summon 64 ghosts for every line';

export interface TabletProps { store: StoreLike; actions: StudioActions; fileMessages?: string[] }

function groupsOf(lines: LineModel[]): { group: string | undefined; lines: LineModel[] }[] {
  const out: { group: string | undefined; lines: LineModel[] }[] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && last.group === l.group) last.lines.push(l);
    else out.push({ group: l.group, lines: [l] });
  }
  return out;
}

export function SummonAllButton({ store, actions }: { store: StoreLike; actions: StudioActions }) {
  const run = useStudio(store, (s) => s.run);
  const pool = useStudio(store, (s) => s.poolConfigured);
  const hero = useStudio(store, (s) => s.hero);
  const lines = useStudio(store, (s) => s.lines);
  const any = lines.some((l) => l.compiled);
  const canSummon = pool && hero !== 'failed' && hero !== 'no-webgl';
  return (
    <button
      type="button"
      className="golem-btn golem-btn-primary"
      disabled={!run && (!canSummon || !any)}
      onClick={() => (run ? actions.stop() : actions.summonAll())}
    >{run ? STOP_LABEL : SUMMON_ALL_LABEL}</button>
  );
}

export function Tablet({ store, actions, fileMessages = [] }: TabletProps) {
  const lines = useStudio(store, (s) => s.lines);
  const selectedId = useStudio(store, (s) => s.selectedId);
  const run = useStudio(store, (s) => s.run);
  const pool = useStudio(store, (s) => s.poolConfigured);
  const hero = useStudio(store, (s) => s.hero);
  const canSummon = pool && hero !== 'failed' && hero !== 'no-webgl';
  return (
    <aside className="golem-tablet" aria-label="Requirements">
      <h2 className="golem-h">Requirements</h2>
      {lines.length === 0 ? <p className="golem-empty">{EMPTY_TEXT}</p> : (
        <>
          <div className="golem-tablet-actions"><SummonAllButton store={store} actions={actions} /></div>
          {!pool ? <p className="golem-note">{NO_POOL_TEXT}</p> : null}
          {groupsOf(lines).map((g, gi) => (
            <section key={gi} className="golem-group" aria-label={g.group ?? 'Requirements'}>
              {g.group ? <h3 className="golem-group-h">{g.group}</h3> : null}
              <ul className="golem-lines">
                {g.lines.map((l) => (
                  <RequirementLine
                    key={l.id}
                    line={l}
                    selected={l.id === selectedId}
                    running={run?.lineId === l.id}
                    canSummon={canSummon}
                    actions={actions}
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      {fileMessages.length > 0 ? (
        <ul className="golem-diags golem-file-diags" aria-label="Messages about requirements.md">
          {fileMessages.map((m, i) => <li key={i} className="golem-diag-warn">{m}</li>)}
        </ul>
      ) : null}
    </aside>
  );
}
