// Free-text editor for one requirement line: a transparent textarea over a mirrored layer that
// draws the diagnostic underlines at the exact code-unit offsets. Never writes a file.
import { useEffect, useId, useRef, useState } from 'react';
import type { Diagnostic } from '../types.js';
import { applySuggestion, diagnosticLabel, underlineRanges } from './diagnostics-view.js';

export const RECOMPILE_MS = 100;

export interface LineEditorProps {
  lineId: string;
  text: string;
  compile(text: string): { diagnostics: Diagnostic[] };
  /** Enter or blur with a line that compiles. */
  onCommit(text: string): void;
  /** Escape: the previous text is restored. */
  onCancel(): void;
}

export function LineEditor({ lineId, text, compile, onCommit, onCancel }: LineEditorProps) {
  const [value, setValue] = useState(text);
  const [diags, setDiags] = useState<Diagnostic[]>(() => compile(text).diagnostics);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const done = useRef(false);
  const listId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); return () => { if (timer.current) clearTimeout(timer.current); }; }, []);

  const recompileSoon = (v: string): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = undefined; setDiags(compile(v).diagnostics); }, RECOMPILE_MS);
  };

  const tryCommit = (v: string): void => {
    if (done.current) return;
    const d = compile(v).diagnostics;
    setDiags(d);
    if (d.some((x) => x.severity === 'error')) return;
    done.current = true;
    onCommit(v);
  };

  const errors = diags.filter((d) => d.severity === 'error');
  const ranges = underlineRanges(value, diags);
  const parts: { text: string; mark: boolean }[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) parts.push({ text: value.slice(pos, r.start), mark: false });
    parts.push({ text: value.slice(r.start, r.end), mark: true });
    pos = r.end;
  }
  if (pos < value.length) parts.push({ text: value.slice(pos), mark: false });

  return (
    <div className="golem-editor">
      <div className="golem-editor-box">
        <div className="golem-editor-mirror" aria-hidden="true">
          {parts.map((p, i) => (p.mark ? <mark key={i} className="golem-wavy">{p.text}</mark> : <span key={i}>{p.text}</span>))}
          {'\u200b'}
        </div>
        <textarea
          ref={ref}
          className="golem-editor-text"
          aria-label={`Edit line ${lineId}`}
          aria-invalid={errors.length > 0}
          aria-describedby={diags.length > 0 ? listId : undefined}
          spellCheck={false}
          value={value}
          rows={3}
          onChange={(e) => { setValue(e.target.value); recompileSoon(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); done.current = true; onCancel(); }
            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); tryCommit(e.currentTarget.value); }
          }}
          onBlur={(e) => tryCommit(e.currentTarget.value)}
        />
      </div>
      {diags.length > 0 ? (
        <ul id={listId} className="golem-diags">
          {diags.map((d, i) => {
            const fixed = applySuggestion(value, d);
            return (
              <li key={i} className={d.severity === 'error' ? 'golem-diag-error' : 'golem-diag-warn'}>
                <span>{diagnosticLabel(d, lineId)}</span>
                {d.suggestion && fixed !== undefined ? (
                  <button
                    type="button"
                    className="golem-btn golem-btn-quiet"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setValue(fixed); setDiags(compile(fixed).diagnostics); ref.current?.focus(); }}
                  >Use suggestion: {d.suggestion}</button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
