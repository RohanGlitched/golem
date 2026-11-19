// A number that eases to its new value over 250 ms on its own animation loop. The final value is
// always in the DOM as text; the moving copy is aria-hidden.
import { useEffect, useRef, useState } from 'react';
import { TweenLoop } from '../core/tween.js';

export interface NumberTweenProps {
  value: number;
  format?(v: number): string;
  reduced?: boolean;
  durationMs?: number;
  raf?(cb: (ts: number) => void): number;
  caf?(id: number): void;
  now?(): number;
}

const defaultFormat = (v: number): string => String(Math.round(v));

export function NumberTween({ value, format = defaultFormat, reduced = false, durationMs = 250, raf, caf, now }: NumberTweenProps) {
  const [shown, setShown] = useState(value);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const loop = useRef<TweenLoop | undefined>(undefined);
  if (!loop.current) {
    loop.current = new TweenLoop({
      raf: raf ?? ((cb) => globalThis.requestAnimationFrame(cb)),
      caf: caf ?? ((id) => globalThis.cancelAnimationFrame(id)),
      now: now ?? (() => globalThis.performance.now()),
      reduced: () => reducedRef.current,
    }, (_k, v) => setShown(v));
  }
  useEffect(() => { loop.current!.to('v', value, durationMs); }, [value, durationMs]);
  useEffect(() => () => loop.current?.dispose(), []);
  const final = format(value);
  return (
    <span className="golem-num golem-tween">
      <span aria-hidden="true">{reduced ? final : format(shown)}</span>
      <span className="golem-sr-only">{final}</span>
    </span>
  );
}
