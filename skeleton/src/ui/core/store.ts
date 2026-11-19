// Small store with coalesced notification (at most one per frame).
import type { StudioState } from '../types.js';

export type Listener = () => void;

export class StudioStore {
  private state: StudioState;
  private readonly listeners = new Set<Listener>();
  private queued = false;
  private handle = 0;

  constructor(
    initial: StudioState,
    private readonly sched: { raf(cb: () => void): number; caf(id: number): void } = {
      raf: (cb) => globalThis.requestAnimationFrame(() => cb()),
      caf: (id) => globalThis.cancelAnimationFrame(id),
    },
  ) { this.state = initial; }

  getState = (): StudioState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  /** Replaces the state with a shallow merge; notifies once per frame. */
  update(patch: Partial<StudioState> | ((s: StudioState) => Partial<StudioState>)): void {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.queueNotify();
  }

  setLine(id: string, patch: Partial<StudioState['lines'][number]>): void {
    this.update((s) => ({ lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  }

  addMessage(kind: 'info' | 'warning' | 'error', text: string, id = text): void {
    this.update((s) => ({
      messages: s.messages.some((m) => m.id === id) ? s.messages : [...s.messages, { id, kind, text }],
    }));
  }

  removeMessage(id: string): void {
    this.update((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
  }

  private queueNotify(): void {
    if (this.queued) return;
    this.queued = true;
    this.handle = this.sched.raf(() => { this.queued = false; this.flush(); });
  }

  flush(): void {
    if (this.queued) { this.sched.caf(this.handle); this.queued = false; }
    for (const l of [...this.listeners]) l();
  }
}
