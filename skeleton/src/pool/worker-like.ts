// What the scheduler needs from a worker, whatever the transport.
import type { HostMessage, WorkerMessage } from './protocol.js';

export interface WorkerLike {
  post(msg: HostMessage, transfer?: ArrayBuffer[]): void;
  onMessage(cb: (m: WorkerMessage) => void): void;
  /** Error event or unexpected exit. */
  onCrash(cb: (reason: string) => void): void;
  terminate(): Promise<void>;
}

/** `generation` counts the restarts of the slot (0 for the first worker). */
export type WorkerFactory = (slot: number, generation: number) => WorkerLike;

export interface SchedulerTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
