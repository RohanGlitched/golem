// One requirement line on the Tablet: ID, sentence with live quantities, status text and shape.
import { Fragment, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { marginText, statusText } from '../run/status.js';
import type { Kind, LineModel, LineStatus } from '../types.js';
import type { StudioActions } from './actions.js';
import { LineEditor } from './line-editor.js';
import { applySuggestion, diagnosticLabel } from './diagnostics-view.js';
import { fractureWord, livingSegments, signedMarginText } from './living.js';
import type { LivingSegment } from './living.js';
import { QuantityControl } from './quantity-control.js';
import { formatSpan, rewriteSpan } from './quantity-edit.js';

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
  const segs = useMemo(() => livingSegments(line.text, actions.tiltWords), [line.text, actions.tiltWords]);
  const hasError = line.diagnostics.some((d) => d.severity === 'error');
  const status = lineStatusText(line);
  const margin = line.status === 'broken' && line.counterexample
    ? marginText(line.counterexample.robustness, line.unit ?? '') : undefined;
  // The fracture: at the word of the signal that broke first, else at the first word of the Response_Clause.
  const fractureAt = line.status === 'broken' ? (line.fracture ?? (() => {
    const w = fractureWord(segs, undefined);
    return w ? { start: w.start, end: w.end, margin: line.counterexample?.robustness ?? Number.NaN, unit: line.unit ?? '' } : undefined;
  })()) : undefined;
  const pre = segs.filter((s) => !s.response);
  const resp = segs.filter((s) => s.response);
  const renderSeg = (s: LivingSegment): ReactNode => {
    const key = `${s.start}:${s.kind}`;
    if (s.kind === 'keyword') return <span key={key} className="golem-kw">{s.text}</span>;
    if (s.kind === 'quantity' && s.q) {
      const q = s.q;
      const control = (
        <QuantityControl
          key={`${key}:${line.text.length}`}
          info={q}
          label={`${KIND_LABEL[q.kind]} in line ${line.id}`}
          disabled={running}
          onCommit={(span) => actions.commitLine(line.id, rewriteSpan(line.text, s.start, s.end, span))}
          {...(actions.previewQuantity ? { onPreview: (v: number) => actions.previewQuantity?.(line.id, rewriteSpan(line.text, s.start, s.end, formatSpan(q, v, Math.max(q.decimals, 6)))) } : {})}
        />
      );
      return s.bind ? <span key={key} className={`golem-bind golem-bind-${s.bind}`} data-golem-bind={s.bind}>{control}</span> : control;
    }
    if (s.kind === 'word') {
      const cls = `golem-w${s.bind ? ` golem-bind-${s.bind}` : ''}`;
      if (fractureAt && fractureAt.start === s.start) {
        return (
          <Fragment key={key}>
            <span className={`${cls} golem-fracture-word`} {...(s.bind ? { 'data-golem-bind': s.bind } : {})} data-golem-fracture={line.fracture?.signal ?? ''}>
              {s.text}<span className="golem-fracture golem-fracture-at" aria-hidden="true" />
            </span>
            <span className="golem-fracture-margin golem-num">{` ${signedMarginText(fractureAt.margin, fractureAt.unit)}`}</span>
          </Fragment>
        );
      }
      return s.bind ? <span key={key} className={cls} data-golem-bind={s.bind}>{s.text}</span> : <span key={key}>{s.text}</span>;
    }
    return <span key={key}>{s.text}</span>;
  };

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
          {fractureAt ? null : line.status === 'broken' ? <span className="golem-fracture" aria-hidden="true" /> : null}
          {pre.map(renderSeg)}
          {resp.length > 0 ? <span className="golem-response">{resp.map(renderSeg)}</span> : null}
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
