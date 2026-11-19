// Signature_Bar: the strip under the stage. The timeline scrubber (all ghosts of the generation at once, with
// Play/Freeze) and the toggles of the signature moments. Plain DOM: the scrubber follows the swarm every frame,
// and writes only when the shown value changes.
export const SCRUB_LABEL = 'Ghost time';
export const FREEZE_LABEL = 'Freeze';
export const PLAY_LABEL = 'Play';

export interface BarHandlers {
  /** The scrubber moved to ghost time `tau` seconds. */
  onScrub(tau: number): void;
  onPlay(): void;
  onFreeze(): void;
}

const STEP_S = 0.01;

export class SignatureBar {
  readonly el: HTMLElement;
  readonly range: HTMLInputElement;
  readonly playBtn: HTMLButtonElement;
  readonly timeEl: HTMLElement;
  private readonly timeline: HTMLElement;
  private readonly tools: HTMLElement;
  private shown = false;
  private tauShown = Number.NaN;
  private durShown = Number.NaN;
  private frozenShown: boolean | undefined;

  constructor(doc: Document, private readonly h: BarHandlers) {
    this.el = doc.createElement('section');
    this.el.className = 'golem-sigbar';
    this.el.setAttribute('aria-label', 'Ghost timeline and stage tools');
    this.timeline = doc.createElement('div');
    this.timeline.className = 'golem-timeline';
    this.timeline.hidden = true;
    this.playBtn = doc.createElement('button');
    this.playBtn.type = 'button';
    this.playBtn.className = 'golem-btn golem-btn-quiet';
    this.playBtn.textContent = FREEZE_LABEL;
    this.playBtn.addEventListener('click', () => (this.frozenShown ? this.h.onPlay() : this.h.onFreeze()));
    this.range = doc.createElement('input');
    this.range.type = 'range';
    this.range.min = '0';
    this.range.step = String(STEP_S);
    this.range.setAttribute('aria-label', SCRUB_LABEL);
    this.range.className = 'golem-timeline-range';
    this.range.addEventListener('input', () => this.h.onScrub(Number(this.range.value)));
    this.timeEl = doc.createElement('span');
    this.timeEl.className = 'golem-timeline-time golem-num';
    this.timeline.append(this.playBtn, this.range, this.timeEl);
    this.tools = doc.createElement('div');
    this.tools.className = 'golem-sigtools';
    this.el.append(this.timeline, this.tools);
  }

  /** Per frame: shows the timeline while a generation can be scrubbed, at ghost time tau of duration seconds. */
  setTimeline(visible: boolean, tau: number, duration: number, frozen: boolean): void {
    if (visible !== this.shown) { this.shown = visible; this.timeline.hidden = !visible; }
    if (!visible) return;
    if (frozen !== this.frozenShown) {
      this.frozenShown = frozen;
      this.playBtn.textContent = frozen ? PLAY_LABEL : FREEZE_LABEL;
      this.playBtn.setAttribute('aria-pressed', frozen ? 'true' : 'false');
    }
    const d = Math.round(duration / STEP_S) * STEP_S;
    if (d !== this.durShown) { this.durShown = d; this.range.max = d.toFixed(2); }
    const t = Math.min(d, Math.max(0, Math.round(tau / STEP_S) * STEP_S));
    if (t !== this.tauShown) {
      this.tauShown = t;
      this.range.value = t.toFixed(2);
      this.timeEl.textContent = `${t.toFixed(2)} s of ${d.toFixed(1)} s`;
    }
  }

  get timelineVisible(): boolean { return this.shown; }

  /** A toggle button (aria-pressed) in the tools group. */
  addToggle(label: string, pressed: boolean, onChange: (on: boolean) => void): HTMLButtonElement {
    const b = this.el.ownerDocument.createElement('button');
    b.type = 'button';
    b.className = 'golem-btn golem-btn-quiet';
    b.textContent = label;
    b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      onChange(on);
    });
    this.tools.appendChild(b);
    return b;
  }

  addButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = this.el.ownerDocument.createElement('button');
    b.type = 'button';
    b.className = 'golem-btn golem-btn-quiet';
    b.textContent = label;
    b.addEventListener('click', onClick);
    this.tools.appendChild(b);
    return b;
  }

  dispose(): void { this.el.remove(); }
}
