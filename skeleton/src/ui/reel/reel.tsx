// The Reel: filmstrip of the failure, its summary, replay controls, Copy seed and Pin this seed.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { seedToJson } from '../run/seed-json.js';
import type { ReelData, StoreLike, StudioActions } from '../tablet/actions.js';
import { useStudio } from '../tablet/actions.js';
import type { Counterexample } from '../types.js';

export const NO_CE_TEXT = 'No counterexample selected. A broken line shows its failure here.';
export const COPY_FAILED_TEXT = 'Copy failed: the seed is shown below, select it to copy';

export function ReplayControls({ store, actions }: { store: StoreLike; actions: StudioActions }) {
  const r = useStudio(store, (s) => s.replay);
  const reduced = useStudio(store, (s) => s.reducedMotion);
  if (!r?.active) return null;
  const step = r.fps > 0 ? 1 / r.fps : 0.01;
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); actions.stepFrame(e.key === 'ArrowRight' ? 1 : -1); }
  };
  const tickLeft = r.duration > 0 ? `${(100 * Math.min(r.worstTau, r.duration)) / r.duration}%` : '0%';
  return (
    <div className="golem-reel-row golem-replay" role="group" aria-label="Replay controls">
      {reduced
        ? <button type="button" className="golem-btn" onClick={() => actions.stepFrame(1)}>Next frame</button>
        : <button type="button" className="golem-btn" onClick={() => (r.playing ? actions.pause() : actions.play())}>{r.playing ? 'Pause' : 'Play'}</button>}
      <button type="button" className="golem-btn" onClick={() => actions.backToLive()}>Back to live</button>
      <div className="golem-scrubber">
        <input
          type="range"
          role="slider"
          aria-label="Replay time"
          min={0}
          max={r.duration}
          step={step}
          value={r.t}
          aria-valuemin={0}
          aria-valuemax={r.duration}
          aria-valuenow={Number(r.t.toFixed(2))}
          aria-valuetext={`${r.t.toFixed(2)} s after the push`}
          onChange={(e) => actions.seekTime(Number(e.currentTarget.value))}
          onKeyDown={onKey}
        />
        <span className="golem-scrub-tick" style={{ left: tickLeft }} aria-hidden="true" />
      </div>
      <span className="golem-num" aria-hidden="true">{`${r.t.toFixed(2)} s`}</span>
    </div>
  );
}

export function Reel({ store, actions }: { store: StoreLike; actions: StudioActions }) {
  const lines = useStudio(store, (s) => s.lines);
  const selectedId = useStudio(store, (s) => s.selectedId);
  const line = lines.find((l) => l.id === selectedId);
  const ce = line?.status === 'broken' ? line.counterexample : undefined;
  const ceKey = ce ? `${line!.id}:${ce.seed}:${JSON.stringify(ce.scenario)}` : '';
  const [data, setData] = useState<ReelData | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [copyField, setCopyField] = useState<string | undefined>(undefined);
  const [pinsVersion, setPinsVersion] = useState(0);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    setData(undefined); setError(undefined); setCopyField(undefined);
    if (!ce || !line) return;
    const ac = new AbortController();
    let stopFilm: (() => void) | undefined;
    actions.loadReplay(line.id, ac.signal).then((d) => {
      if (ac.signal.aborted) return;
      setData(d);
      queueMicrotask(() => { if (!ac.signal.aborted) stopFilm = actions.renderFilmstrip(d, canvases.current); });
    }, (e: unknown) => {
      if (ac.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
      setError(e instanceof Error ? e.message : String(e));
    });
    return () => { ac.abort(); stopFilm?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceKey]);

  const copy = async (c: Counterexample): Promise<void> => {
    const ok = await actions.copySeed(c);
    setCopyField(ok ? undefined : seedToJson(c));
  };

  const pins = line ? actions.pinsOf(line.id) : [];
  void pinsVersion;

  return (
    <section className="golem-reel" aria-label="Counterexample reel">
      <h2 className="golem-h">Counterexample{line && ce ? ` for ${line.id}` : ''}</h2>
      {!ce || !line ? <p className="golem-note">{NO_CE_TEXT}</p> : (
        <>
          <p className="golem-reel-summary">
            {actions.summaryOf(line.id, ce)}
            {ce.classification ? <span className="golem-note">{` (classification: ${ce.classification})`}</span> : null}
          </p>
          <div className="golem-reel-strip" role="list" aria-label="Frames around the failure">
            {(data?.entries ?? Array.from({ length: 8 }, () => undefined)).map((e, k) => (
              <figure key={k} role="listitem" className={`golem-frame${e?.isWorst ? ' golem-frame-worst' : ''}`}>
                <canvas
                  ref={(el) => { canvases.current[k] = el; }}
                  width={160}
                  height={120}
                  role="img"
                  aria-label={data?.labels[k] ?? 'Frame loading'}
                />
                <figcaption className="golem-num">{e ? `${e.tau.toFixed(2)} s${e.isWorst ? ' worst' : ''}` : '…'}</figcaption>
              </figure>
            ))}
          </div>
          {error ? <p className="golem-q-msg" role="status">{`The replay trial failed: ${error}`}</p> : null}
          <div className="golem-reel-row">
            <button type="button" className="golem-btn golem-btn-primary" disabled={!data} onClick={() => actions.replay(line.id)}>
              {actions.replayLabelOf(line.id)}
            </button>
            <button type="button" className="golem-btn" onClick={() => { void copy(ce); }}>Copy seed</button>
            <button type="button" className="golem-btn" onClick={() => { actions.pin(ce); setPinsVersion((v) => v + 1); }}>Pin this seed</button>
          </div>
          {copyField !== undefined ? (
            <textarea className="golem-seed-field" readOnly rows={8} aria-label="Seed JSON" value={copyField} onFocus={(e) => e.currentTarget.select()} />
          ) : null}
        </>
      )}
      <ReplayControls store={store} actions={actions} />
      {line && pins.length > 0 ? (
        <ul className="golem-pins" aria-label={`Pinned seeds for ${line.id}`}>
          {pins.map((p, i) => (
            <li key={i}>
              <span>{`Seed ${p.seed}: ${actions.summaryOf(line.id, p)}`}</span>{' '}
              <button type="button" className="golem-btn golem-btn-quiet" onClick={() => { actions.removePin(p); setPinsVersion((v) => v + 1); }}>Remove pin</button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
