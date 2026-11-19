// Which controller the G1 runs: Unitree's policy alone, or the policy with Kiro's balance reflex on top.
// The choice is made on the page and must reach the page thread's sim (the live robot) and every trial worker
// (the ghosts). Workers are separate threads, so the choice travels on a BroadcastChannel:
//   page   -> workers: { type: 'set', kind, rev }   on every change, and again in answer to a 'hello'
//   worker -> page:    { type: 'hello' }            when the worker starts, so one that starts late (or restarts) catches up
// `rev` rises with each change, so a late answer to a 'hello' never overwrites a newer choice.
// The module takes the setter as an argument and imports nothing from the app, so it is the same code on both sides.

export type ControllerKind = 'none' | 'kiro';

export const CONTROLLER_CHANNEL = 'golem-stagger-controller';

export const CONTROLLER_LABELS: Record<ControllerKind, string> = {
  none: "Unitree's policy",
  kiro: "+ Kiro's reflex",
};

export type ControllerMessage = { type: 'set'; kind: ControllerKind; rev: number } | { type: 'hello' };

/** The part of BroadcastChannel this module uses (a fake in tests). */
export interface ChannelLike {
  postMessage(msg: ControllerMessage): void;
  addEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
  close(): void;
}

export const isControllerKind = (x: unknown): x is ControllerKind => x === 'none' || x === 'kiro';

function parse(data: unknown): ControllerMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const m = data as { type?: unknown; kind?: unknown; rev?: unknown };
  if (m.type === 'hello') return { type: 'hello' };
  if (m.type === 'set' && isControllerKind(m.kind) && typeof m.rev === 'number' && Number.isFinite(m.rev)) return { type: 'set', kind: m.kind, rev: m.rev };
  return undefined;
}

/** Worker side: applies every choice the page makes, and asks for the current one at start. Returns a function that stops listening. */
export function followControllerChoice(channel: ChannelLike, apply: (kind: ControllerKind) => void): () => void {
  let rev = -1;
  channel.addEventListener('message', (e) => {
    const m = parse(e.data);
    if (m?.type !== 'set' || m.rev <= rev) return;
    rev = m.rev;
    apply(m.kind);
  });
  channel.postMessage({ type: 'hello' });
  return () => channel.close();
}

export interface ControllerChoice {
  current(): ControllerKind;
  /** Applies the choice on the page thread and tells every worker. */
  choose(kind: ControllerKind): void;
  close(): void;
}

/** Page side: holds the choice (default Unitree's policy), applies it here, tells the workers and answers a worker's 'hello'. */
export function hostControllerChoice(channel: ChannelLike, apply: (kind: ControllerKind) => void, initial: ControllerKind = 'none'): ControllerChoice {
  let kind = initial;
  let rev = 0;
  apply(kind);
  const say = (): void => channel.postMessage({ type: 'set', kind, rev });
  channel.addEventListener('message', (e) => {
    if (parse(e.data)?.type === 'hello') say();
  });
  return {
    current: () => kind,
    choose(next) {
      kind = next;
      rev += 1;
      apply(kind);
      say();
    },
    close: () => channel.close(),
  };
}
