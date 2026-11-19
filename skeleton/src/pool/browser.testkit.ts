// Test-only: a fake global `Worker` and `navigator` for the browser adapter.
import type { WorkerMessage } from './protocol.js';
import type { FakeWorkerFactory } from './testing.js';
import type { WorkerLike } from './worker-like.js';

const g = globalThis as Record<string, unknown>;
const saved = { Worker: g['Worker'], navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };

export function setNavigator(hardwareConcurrency: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency }, configurable: true, writable: true });
}

export interface MadeWorker { url: string; opts: { type: string; name?: string }; terminated: boolean }

/** Installs a fake global `Worker` whose instances are bridged to FakeWorkers from `fake`. */
export function installFakeWorker(fake: FakeWorkerFactory): MadeWorker[] {
  const made: MadeWorker[] = [];
  class FakeGlobalWorker {
    private readonly rec: MadeWorker;
    private readonly inner: WorkerLike;
    private readonly listeners: Record<string, ((e: { data?: unknown; message?: string }) => void)[]> = {};
    constructor(url: string | URL, opts: { type: string; name?: string }) {
      this.rec = { url: String(url), opts, terminated: false };
      made.push(this.rec);
      const [, slot, gen] = /golem-(\d+)-(\d+)/.exec(opts.name ?? '') ?? [];
      this.inner = fake.factory(Number(slot), Number(gen));
      this.inner.onMessage((m: WorkerMessage) => this.emit('message', { data: m }));
      this.inner.onCrash((r) => this.emit('error', { message: r }));
    }
    private emit(type: string, e: { data?: unknown; message?: string }): void { for (const cb of this.listeners[type] ?? []) cb(e); }
    addEventListener(type: string, cb: (e: { data?: unknown; message?: string }) => void): void { (this.listeners[type] ??= []).push(cb); }
    postMessage(msg: never, transfer: ArrayBuffer[]): void { this.inner.post(msg, transfer); }
    terminate(): void { this.rec.terminated = true; void this.inner.terminate(); }
  }
  g['Worker'] = FakeGlobalWorker;
  return made;
}

/** Restores the real globals (call in afterEach). */
export function restoreBrowserGlobals(): void {
  g['Worker'] = saved.Worker;
  if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator);
  else delete g['navigator'];
}
