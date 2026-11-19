// Live_Sentence: writes the living sentence's CSS variables on the selected sentence. No React: the values change
// every frame while a trial plays, and the store would re-render the tablet. Writes only when a value moved by
// more than a display step, so a still robot writes nothing.
export const TILT_STEP_DEG = 0.1;
export const FRACTION_STEP = 0.005;

export class LiveSentence {
  private el: HTMLElement | null = null;
  private tilt = 0;
  private fuse = 0;
  private force = 0;
  private live = false;

  constructor(private readonly root: HTMLElement) {}

  /** The selected sentence element, re-found when React replaced it or the selection moved. */
  private target(): HTMLElement | null {
    const el = this.el;
    if (el && el.isConnected && el.parentElement?.classList.contains('golem-line-selected')) return el;
    this.el = this.root.querySelector<HTMLElement>('.golem-line-selected .golem-sentence');
    if (this.el && this.el !== el) { this.tilt = Number.NaN; this.fuse = Number.NaN; this.force = Number.NaN; this.live = false; }
    return this.el;
  }

  /** The selection changed: forget the element so the next write finds the new one. */
  invalidate(): void {
    if (this.el) { this.clear(this.el); this.el = null; }
  }

  write(tiltDeg: number, fuse: number, force: number): void {
    const el = this.target();
    if (!el) return;
    if (!this.live) { this.live = true; el.dataset['golemLive'] = '1'; }
    if (!(Math.abs(tiltDeg - this.tilt) < TILT_STEP_DEG)) { this.tilt = tiltDeg; el.style.setProperty('--golem-tilt', tiltDeg.toFixed(1)); }
    if (!(Math.abs(fuse - this.fuse) < FRACTION_STEP) || (fuse === 1 && this.fuse !== 1)) { this.fuse = fuse; el.style.setProperty('--golem-fuse', fuse.toFixed(3)); }
    if (!(Math.abs(force - this.force) < FRACTION_STEP) || (force === 0 && this.force !== 0)) { this.force = force; el.style.setProperty('--golem-force', force.toFixed(3)); }
  }

  /** No trial plays: the bound words rest (no tilt, empty fuse, no underline). */
  rest(): void {
    if (!this.live) return;
    const el = this.target();
    if (el) this.clear(el);
  }

  private clear(el: HTMLElement): void {
    el.style.removeProperty('--golem-tilt');
    el.style.removeProperty('--golem-fuse');
    el.style.removeProperty('--golem-force');
    delete el.dataset['golemLive'];
    this.live = false;
    this.tilt = 0; this.fuse = 0; this.force = 0;
  }

  get playing(): boolean { return this.live; }
}
