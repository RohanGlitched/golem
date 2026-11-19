// One requirement line on the Tablet: ID, sentence with live quantities, status text and shape.
import { useId, useMemo, useState } from 'react';
import { marginText, statusText } from '../run/status.js';
import type { Kind, LineModel, LineStatus } from '../types.js';
import type { StudioActions } from './actions.js';
import { LineEditor } from './line-editor.js';
import { applySuggestion, diagnosticLabel } from './diagnostics-view.js';
import { QuantityControl } from './quantity-control.js';
import { rewriteSpan } from './quantity-edit.js';
import { segmentLine } from './segments.js';

export const SUMMON_LABEL = 'Summon 64 ghosts';
export const STOP_LABEL = 'Stop the run';

const KIND_LABEL: Record<Kind, string> = {
  force: 'Force', duration: 'Duration', length: 'Length', speed: 'Speed', angle: 'Angle', mass: 'Mass',
  ratio: 'Ratio', count: 'Count', phase: 'Phase',
};

/** Status shape: not colour alone (text plus a glyph shape). */
const SHAPE: Record<LineStatus, string> = { untested: '○', running: '◌', held: '■', broken: '▲', error: '✕' };

export interface RequirementLineProps {
  line: LineModel;
  selected: boolean;
  /** This line's run is active. */
  running: boolean;
  canSummon: boolean;
  actions: StudioActions;
}

export function lineStatusText(line: LineModel): string {
  if (line.status === 'error') return line.error ? `Error: ${line.error}` : line.diagnostics.some((d) => d.severity === 'error') ? 'Error: this line does not compile, see the messages below' : 'Error';
  if (line.status === 'running') return statusText({ status: 'running', trials: line.progress?.trials ?? 0 });
  if (line.status === 'broken') return `Broken: ${line.summary ?? 'counterexample found'}`;
  if (line.status === 'held') return statusText({ status: 'held', ...(line.verdict ? { verdict: line.verdict } : {}), unit: line.unit ?? '' });
  return statusText({ status: 'untested' });
}

export function RequirementLine({ line, selected, running, canSummon, actions }: RequirementLineProps) {
  const [editing, setEditing] = useState(false);
  const statusId = useId();
  const textId = useId();
  const segs = useMemo(() => segmentLine(line.text), [line.text]);
  const hasError = line.diagnostics.some((d) => d.severity === 'error');
  const status = lineStatusText(line);
  const margin = line.status === 'broken' && line.counterexample
    ? marginText(line.counterexample.robustness, line.unit ?? '') : undefined;

  return (
    <li
      className={`golem-line golem-status-${line.status}${selected ? ' golem-line-selected' : ''}`}
      aria-current={selected ? 'true' : undefined}
      aria-labelledby={textId}
      aria-describedby={statusId}
      onClick={(e) => { if ((e.target as HTMLElement).closest('button,input,textarea,[role="spinbutton"]')) return; actions.select(line.id); }}
    >
      <span id={textId} className="golem-sr-only">{`${line.id} ${line.text}`}</span>
      <div className="golem-line-head">
        <button
          type="button"
          className="golem-line-id"
          aria-label={`Select line ${line.id}`}
          aria-describedby={statusId}
          onClick={() => actions.select(line.id)}
        >{line.id}</button>
      </div>
      {editing ? (
        <LineEditor
          lineId={line.id}
          text={line.text}
          compile={(t) => actions.compile(line.id, t)}
          onCommit={(t) => { setEditing(false); actions.commitLine(line.id, t); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="golem-sentence" aria-hidden="false">
          {line.status === 'broken' ? <span className="golem-fracture" aria-hidden="true" /> : null}
          {segs.map((s, i) => {
            if (s.kind === 'keyword') return <span key={i} className="golem-kw">{s.text}</span>;
            if (s.kind === 'quantity' && s.q) {
              const q = s.q;
              return (
                <QuantityControl
                  key={`${i}:${s.start}:${line.text.length}`}
                  info={q}
                  label={`${KIND_LABEL[q.kind]} in line ${line.id}`}
                  disabled={running}
                  onCommit={(span) => actions.commitLine(line.id, rewriteSpan(line.text, s.start, s.end, span))}
                />
              );
            }
            return <span key={i}>{s.text}</span>;
          })}
        </p>
      )}
      <p id={statusId} className="golem-status">
        <span className="golem-status-shape" aria-hidden="true">{SHAPE[line.status]}</span>{' '}
        <span className="golem-status-text golem-num-mixed">{status}</span>
        {margin ? <span className="golem-margin golem-num">{` margin ${margin}`}</span> : null}
        {line.stale ? <span className="golem-stale">{' (stale)'}</span> : null}
      </p>
      {!editing && line.diagnostics.length > 0 ? (
        <ul className="golem-diags">
          {line.diagnostics.map((d, i) => {
            const fixed = applySuggestion(line.text, d);
            return (
              <li key={i} className={d.severity === 'error' ? 'golem-diag-error' : 'golem-diag-warn'}>
                <span>{diagnosticLabel(d, line.id)}</span>
                {d.suggestion && fixed !== undefined ? (
                  <button type="button" className="golem-btn golem-btn-quiet" onClick={() => actions.commitLine(line.id, fixed)}>
                    Use suggestion: {d.suggestion}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="golem-line-actions">
        {!editing ? (
          <button type="button" className="golem-btn golem-btn-quiet" onClick={() => setEditing(true)} disabled={running}>Edit line</button>
        ) : null}
        {!hasError && line.compiled ? (
          <button
            type="button"
            className="golem-btn"
            disabled={!canSummon && !running}
            onClick={() => (running ? actions.stop() : actions.summon(line.id))}
          >{running ? STOP_LABEL : SUMMON_LABEL}</button>
        ) : null}
      </div>
    </li>
  );
}
