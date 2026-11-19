// Verdict_Panel: what was searched and what was found, in tabular figures. Never claims a proof.
import type { StoreLike } from '../tablet/actions.js';
import { useStudio } from '../tablet/actions.js';
import type { Budget } from '../types.js';
import { NumberTween } from './number-tween.js';
import { budgetText, verdictRows } from './verdict-rows.js';

export interface VerdictPanelProps { store: StoreLike; poolSize: number; budget: Budget }

export function VerdictPanel({ store, poolSize, budget }: VerdictPanelProps) {
  const lines = useStudio(store, (s) => s.lines);
  const selectedId = useStudio(store, (s) => s.selectedId);
  const run = useStudio(store, (s) => s.run);
  const aura = useStudio(store, (s) => s.aura);
  const reduced = useStudio(store, (s) => s.reducedMotion);
  const line = lines.find((l) => l.id === (run?.lineId ?? selectedId));
  const v = line?.verdict;
  const live = run && line && run.lineId === line.id;
  const rows = v && !live ? verdictRows(v, poolSize, line.unit ?? '', budget) : undefined;
  return (
    <section className="golem-verdict" aria-label="Verdict">
      <h2 className="golem-h">Verdict{line ? ` for ${line.id}` : ''}</h2>
      {live ? (
        <dl className="golem-rows">
          <div><dt>Trials so far</dt><dd><NumberTween value={run.trials} reduced={reduced} /></dd></div>
          <div><dt>Generation</dt><dd><NumberTween value={run.generation} reduced={reduced} /></dd></div>
          <div><dt>Pool size</dt><dd className="golem-num">{poolSize}</dd></div>
          <div><dt>Search budget</dt><dd className="golem-num">{budgetText(budget)}</dd></div>
        </dl>
      ) : rows ? (
        <dl className="golem-rows">
          {rows.rows.map((r) => {
            const n = Number(r.value);
            return (
              <div key={r.label}>
                <dt>{r.label}</dt>
                <dd>{Number.isFinite(n) && /^\d+$/.test(r.value) ? <NumberTween value={n} reduced={reduced} /> : <span className="golem-num">{r.value}</span>}</dd>
              </div>
            );
          })}
        </dl>
      ) : <p className="golem-note">{line ? 'Summon the ghosts to test this line.' : 'Select a line to see its verdict.'}</p>}
      {rows ? <p className="golem-sentence-small">{rows.sentence}</p> : null}
      {line?.stale ? <p className="golem-stale">This verdict is stale: the line changed or its run was stopped.</p> : null}
      <p className="golem-aura-summary">{aura.summary}</p>
    </section>
  );
}
