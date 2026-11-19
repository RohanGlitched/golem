// Tweens for numbers. Own rAF loop, never the stage scheduler.
export const easeOutCubic = (p: number): number => { const q = 1 - p; return 1 - q * q * q; };

export function tweenValue(from: number, to: number, p: number): number {
  if (!(p > 0)) return from;
  if (p >= 1) return to;
  const v = from + (to - from) * easeOutCubic(p);
  const lo = Math.min(from, to), hi = Math.max(from, to);
  return v < lo ? lo : v > hi ? hi : v;
}

interface Tween { from: number; to: number; start: number; dur: number; value: number }

export class TweenLoop {
  private readonly tweens = new Map<string, Tween>();
  private id = 0;
  constructor(
    private readonly deps: { raf(cb: (ts: number) => void): number; caf(id: number): void; now(): number; reduced(): boolean },
    private readonly onValue: (key: string, v: number) => void,
  ) {}

  to(key: string, target: number, durationMs = 250): void {
    const cur = this.tweens.get(key);
    const from = cur ? cur.value : this.last.get(key) ?? target;
    if (this.deps.reduced() || durationMs <= 0 || from === target) {
      this.tweens.delete(key);
      this.last.set(key, target);
      this.onValue(key, target);
      return;
    }
    this.tweens.set(key, { from, to: target, start: this.deps.now(), dur: durationMs, value: from });
    if (this.id === 0) this.id = this.deps.raf(this.frame);
  }
  private readonly last = new Map<string, number>();

  private readonly frame = (): void => {
    this.id = 0;
    const now = this.deps.now();
    for (const [k, t] of this.tweens) {
      const p = (now - t.start) / t.dur;
      t.value = tweenValue(t.from, t.to, p);
      this.last.set(k, t.value);
      this.onValue(k, t.value);
      if (p >= 1) this.tweens.delete(k);
    }
    if (this.tweens.size > 0) this.id = this.deps.raf(this.frame);
  };

  get running(): boolean { return this.id !== 0; }
  dispose(): void { if (this.id) this.deps.caf(this.id); this.id = 0; this.tweens.clear(); }
}
