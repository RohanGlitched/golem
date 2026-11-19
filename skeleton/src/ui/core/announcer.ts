// Live-region announcements. Never moves focus.
export interface AnnouncerEls { polite: { textContent: string | null }; alert: { textContent: string | null } }

export class Announcer {
  private lastProgress = -Infinity;
  private flip = false;
  constructor(private readonly els: AnnouncerEls) {}

  private put(el: { textContent: string | null }, msg: string): void {
    // A trailing zero-width toggle makes repeated identical messages re-announce.
    this.flip = !this.flip;
    el.textContent = msg + (this.flip ? '' : '\u200b');
  }

  /** At most one per 2000 ms. Returns whether it was emitted. */
  announceProgress(msg: string, nowMs: number): boolean {
    if (nowMs - this.lastProgress < 2000) return false;
    this.lastProgress = nowMs;
    this.put(this.els.polite, msg);
    return true;
  }
  announceFinal(msg: string): void { this.put(this.els.polite, msg); }
  announceError(msg: string): void { this.put(this.els.alert, msg); }
}
