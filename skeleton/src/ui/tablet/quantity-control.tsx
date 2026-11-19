// A quantity in a sentence as a control: drag sideways, use the arrow keys, or type a value.
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { commitTyped, dragQuantity, formatSpan, rangeOf, stepDecimals, stepQuantity } from './quantity-edit.js';
import type { Modifier } from './quantity-edit.js';
import type { QuantityInfo } from './segments.js';

export const DEBOUNCE_MS = 80;

export interface QuantityControlProps {
  info: QuantityInfo;
  label: string;
  limits?: { min?: number; max?: number };
  /** Called 80 ms after the last change with the new span text (same unit and gap as written). */
  onCommit(span: string, value: number): void;
  /** Called on every change, before the debounce (live preview). */
  onPreview?(value: number): void;
  disabled?: boolean;
}

const modOf = (e: { shiftKey: boolean; altKey: boolean }): Modifier => (e.shiftKey ? 'shift' : e.altKey ? 'alt' : 'none');

export function QuantityControl({ info, label, limits, onCommit, onPreview, disabled }: QuantityControlProps) {
  const range = rangeOf(info.kind, info.unit, limits);
  const [value, setValue] = useState(info.value);
  const [decimals, setDecimals] = useState(info.decimals);
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; v: number; moved: boolean } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const msgId = useId();

  useEffect(() => { setValue(info.value); setDecimals(info.decimals); }, [info.value, info.decimals]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const change = (v: number, d: number): void => {
    setValue(v);
    setDecimals(d);
    onPreview?.(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = undefined; onCommit(formatSpan(info, v, d), v); }, DEBOUNCE_MS);
  };

  const step = (dir: 1 | -1, mod: Modifier): void => {
    const d = stepDecimals(info.unit, mod, decimals);
    change(stepQuantity(value, info.unit, dir, mod, range, decimals), d);
  };

  const onKey = (e: KeyboardEvent<HTMLSpanElement>): void => {
    if (disabled) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); step(1, modOf(e)); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); step(-1, modOf(e)); return; }
    if (e.key === 'Enter' || /^[0-9.+-]$/.test(e.key)) {
      e.preventDefault();
      setMessage(undefined);
      setEditing(e.key === 'Enter' ? text : e.key);
    }
  };

  const commitEdit = (raw: string): void => {
    const r = commitTyped(raw, info, range);
    if (!r.ok) { setMessage(r.message); setEditing(undefined); return; }
    setMessage(undefined);
    setEditing(undefined);
    const m = /\.(\d+)/.exec(raw.trim().split(/\s/)[0] ?? '');
    change(r.value, Math.max(m ? (m[1] as string).length : 0, 0));
  };

  const onDown = (e: PointerEvent<HTMLSpanElement>): void => {
    if (disabled || editing !== undefined) return;
    drag.current = { id: e.pointerId, x: e.clientX, v: value, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    setDragging(true);
  };
  const onMove = (e: PointerEvent<HTMLSpanElement>): void => {
    const dd = drag.current;
    if (!dd || dd.id !== e.pointerId) return;
    const dx = e.clientX - dd.x;
    if (Math.abs(dx) >= 4) dd.moved = true;
    const v = dragQuantity(dd.v, dx, info.unit, modOf(e), range, decimals);
    if (v !== value) change(v, stepDecimals(info.unit, modOf(e), decimals));
  };
  const onUp = (e: PointerEvent<HTMLSpanElement>): void => {
    const dd = drag.current;
    if (!dd || dd.id !== e.pointerId) return;
    drag.current = undefined;
    setDragging(false);
  };

  const shown = formatSpan(info, value, decimals);
  const text = info.inheritedUnit ? `${shown} ${info.unit}` : shown;
  const num = Number(formatSpan({ ...info, inheritedUnit: true }, value, decimals));

  if (editing !== undefined) {
    return (
      <span className="golem-q-wrap">
        <input
          className="golem-q-input golem-num"
          aria-label={label}
          defaultValue={editing}
          autoFocus
          size={Math.max(4, editing.length + 2)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.currentTarget.value); }
            else if (e.key === 'Escape') { e.preventDefault(); setEditing(undefined); }
          }}
          onBlur={(e) => commitEdit(e.currentTarget.value)}
        />
      </span>
    );
  }
  return (
    <span className="golem-q-wrap">
      <span
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        className={`golem-q${dragging ? ' golem-q-drag' : ''}`}
        aria-label={label}
        aria-valuenow={num}
        aria-valuemin={range.min}
        {...(Number.isFinite(range.max) ? { 'aria-valuemax': range.max } : {})}
        aria-valuetext={`${num} ${info.unit}`}
        aria-disabled={disabled || undefined}
        aria-describedby={message ? msgId : undefined}
        style={{ touchAction: dragging ? 'none' : 'pan-y' }}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => { if (!disabled) setEditing(text); }}
      >{shown}</span>
      {message ? <span id={msgId} className="golem-q-msg" role="status">{message}</span> : null}
    </span>
  );
}
