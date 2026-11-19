// One job at a time, in arrival order. A job aborted while it is still queued is skipped and rejects with an AbortError.
function abortError(): Error {
  const e = new Error('the call was cancelled before it started');
  e.name = 'AbortError';
  return e;
}

interface Entry {
  job: (signal: AbortSignal) => Promise<unknown>;
  signal: AbortSignal;
  resolve(v: unknown): void;
  reject(e: unknown): void;
  onAbort(): void;
}

export class FifoQueue {
  private readonly queue: Entry[] = [];
  private running = false;
  private activeCount = 0;

  /** 0 or 1. */
  get active(): number { return this.activeCount; }
  get pending(): number { return this.queue.length; }

  run<T>(job: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) { reject(abortError()); return; }
      const entry: Entry = {
        job, signal, resolve: resolve as (v: unknown) => void, reject,
        onAbort: () => {
          const i = this.queue.indexOf(entry);
          if (i >= 0) { this.queue.splice(i, 1); reject(abortError()); }
        },
      };
      signal.addEventListener('abort', entry.onAbort, { once: true });
      this.queue.push(entry);
      this.pump();
    });
  }

  private pump(): void {
    if (this.running) return;
    const entry = this.queue.shift();
    if (entry === undefined) return;
    entry.signal.removeEventListener('abort', entry.onAbort);
    this.running = true;
    this.activeCount = 1;
    Promise.resolve()
      .then(() => entry.job(entry.signal))
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.running = false;
        this.activeCount = 0;
        this.pump();
      });
  }
}

/** Serialises proposal writes with the same semantics. */
export class WriteQueue extends FifoQueue {}
