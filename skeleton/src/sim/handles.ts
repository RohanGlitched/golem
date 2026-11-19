// Handle registry: every MuJoCo handle the sim module creates is tracked here and deleted through
// `release`, which is idempotent. The live count is derived from the set, so it cannot drift.
export interface Deletable { delete(): void }

export class HandleRegistry {
  private readonly handles = new Set<Deletable>();
  private readonly kinds = new Map<Deletable, string>();

  /** Adds a handle to the live set and returns it. */
  track<T extends Deletable>(h: T, kind = 'handle'): T {
    this.handles.add(h);
    this.kinds.set(h, kind);
    return h;
  }

  /** Deletes a live handle once. Returns false (and does nothing) for an unknown or released handle. */
  release(h: Deletable): boolean {
    if (!this.handles.delete(h)) return false;
    this.kinds.delete(h);
    h.delete();
    return true;
  }

  get live(): number {
    return this.handles.size;
  }
}

export const registry = new HandleRegistry();

export function liveHandleCount(): number {
  return registry.live;
}

/** Handles of one trial. Deleted in LIFO order. */
export class TrialScope {
  private readonly stack: Deletable[] = [];

  constructor(private readonly reg: HandleRegistry = registry) {}

  track<T extends Deletable>(h: T, kind = 'handle'): T {
    this.reg.track(h, kind);
    this.stack.push(h);
    return h;
  }

  /**
   * Releases every handle, last created first. A throwing `.delete()` does not stop the rest.
   * The first such error is rethrown afterwards, unless another error is already propagating.
   */
  disposeAll(alreadyPropagating = false): void {
    let first: unknown;
    let failed = false;
    while (this.stack.length > 0) {
      const h = this.stack.pop() as Deletable;
      try {
        this.reg.release(h);
      } catch (e) {
        if (!failed) { failed = true; first = e; }
      }
    }
    if (failed && !alreadyPropagating) throw first;
  }
}
