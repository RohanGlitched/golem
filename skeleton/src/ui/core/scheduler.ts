// Render scheduler: the only requestAnimationFrame that draws the stage.
import type { Reason } from '../types.js';

const BIT: Record<Reason, number> = { simulating: 1, dragging: 2, replaying: 4, 'ghosts-running': 8, transition: 16 };
const NAMES = Object.keys(BIT) as Reason[];

export class RenderScheduler {
  private mask = 0;
  private dirty = false;
  private id = 0;
  private visible = true;
  frames = 0;

  constructor(
    private readonly deps: { raf(cb: (ts: number) => void): number; caf(id: number): void },
    private readonly tick: (tsMs: number) => void,
  ) {}

  private readonly frame = (ts: number): void => {
    this.id = 0;
    this.tick(ts);
    this.frames++;
    this.dirty = false;
    // A tick that asked for another frame (requestOnce, acquire) already holds one pending callback: never queue a
    // second, or the callbacks per vsync double every frame.
    if (this.visible && this.mask !== 0 && this.id === 0) this.id = this.deps.raf(this.frame);
  };

  private schedule(): void {
    if (this.visible && this.id === 0) this.id = this.deps.raf(this.frame);
  }

  acquire(r: Reason): void { this.mask |= BIT[r]; this.schedule(); }

  release(r: Reason): void {
    if ((this.mask & BIT[r]) === 0) return;
    this.mask &= ~BIT[r];
    if (this.mask === 0) { this.dirty = true; this.schedule(); } // final frame
  }

  requestOnce(): void { this.dirty = true; this.schedule(); }

  setVisible(v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    if (!v) {
      if (this.id !== 0) { this.deps.caf(this.id); this.id = 0; }
    } else if (this.mask !== 0 || this.dirty) {
      this.schedule();
    }
  }

  isVisible(): boolean { return this.visible; }
  active(): ReadonlySet<Reason> { return new Set(NAMES.filter((n) => (this.mask & BIT[n]) !== 0)); }
  has(r: Reason): boolean { return (this.mask & BIT[r]) !== 0; }
  pendingFrames(): 0 | 1 { return this.id === 0 ? 0 : 1; }
}
