// Sonifier: Web Audio only, no files. A low drone that follows the live margin, a soft clay thud when a ghost breaks,
// a brief glassy chord when a line holds. Off until the Sound toggle (a user gesture) creates the context. The
// per-frame call (`setMargin`) only schedules parameter changes; nodes are created per event, never per frame.
import {
  CHORD, CHORD_GAIN, CHORD_S, DRONE_GAIN, MASTER_GAIN, THUD_GAIN, THUD_S, ThudLimiter, droneHz, marginScale, panOf,
} from '../core/sonify-math.js';
import { mulberry32 } from '../core/prng.js';

/** The part of AudioContext the sonifier uses; tests pass a fake. */
export type AudioContextLike = Pick<AudioContext,
  'currentTime' | 'destination' | 'state' | 'sampleRate' | 'createGain' | 'createOscillator' | 'createBiquadFilter' | 'createBuffer'
  | 'createBufferSource' | 'resume' | 'suspend' | 'close'> & { createStereoPanner?: AudioContext['createStereoPanner'] };

export class Sonifier {
  enabled = false;
  thuds = 0;
  chords = 0;
  hz = 0;
  private ctx: AudioContextLike | undefined;
  private master: GainNode | undefined;
  private droneGain: GainNode | undefined;
  private osc1: OscillatorNode | undefined;
  private osc2: OscillatorNode | undefined;
  private noise: AudioBuffer | undefined;
  private readonly limiter = new ThudLimiter();
  private suspendTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly make: () => AudioContextLike | undefined) {}

  get state(): string { return this.ctx?.state ?? 'none'; }

  /** Turns sound on or off. The first call must come from a user gesture (browsers start audio only then). */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      if (!this.ctx) this.build();
      const c = this.ctx;
      if (!c || !this.master) { this.enabled = false; return; }
      if (this.suspendTimer !== undefined) { clearTimeout(this.suspendTimer); this.suspendTimer = undefined; }
      void c.resume().catch(() => {});
      this.master.gain.cancelScheduledValues(c.currentTime);
      this.master.gain.setTargetAtTime(MASTER_GAIN, c.currentTime, 0.4);
      this.droneGain?.gain.setTargetAtTime(DRONE_GAIN, c.currentTime, 0.6);
    } else if (this.ctx && this.master) {
      const c = this.ctx;
      this.master.gain.cancelScheduledValues(c.currentTime);
      this.master.gain.setTargetAtTime(0, c.currentTime, 0.08);
      this.suspendTimer = setTimeout(() => { this.suspendTimer = undefined; if (!this.enabled) void c.suspend().catch(() => {}); }, 400);
    }
  }

  private build(): void {
    let c: AudioContextLike | undefined;
    try { c = this.make(); } catch { c = undefined; }
    if (!c) return;
    this.ctx = c;
    const master = c.createGain();
    master.gain.value = 0;
    master.connect(c.destination);
    this.master = master;
    // Drone: a sine and a quiet triangle an octave up, under a 400 Hz lowpass.
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 0.5;
    const g = c.createGain();
    g.gain.value = 0;
    const o1 = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain();
    o1.type = 'sine'; o2.type = 'triangle';
    o1.frequency.value = 55; o2.frequency.value = 110; g2.gain.value = 0.25;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(master);
    o1.start(); o2.start();
    this.osc1 = o1; this.osc2 = o2; this.droneGain = g;
    this.hz = 55;
    // One shared buffer of seeded noise for the thuds.
    const n = Math.max(1, Math.round(c.sampleRate * 0.3));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const ch = buf.getChannelData(0);
    const rng = mulberry32(0x7a1d);
    for (let i = 0; i < n; i++) ch[i] = (2 * rng() - 1) * (1 - i / n);
    this.noise = buf;
  }

  /** Per frame: the drone follows the margin. Schedules only when the pitch moved by more than 0.05 Hz. */
  setMargin(margin: number, unit: string): void {
    if (!this.enabled || !this.ctx || !this.osc1 || !this.osc2) return;
    const f = droneHz(margin, marginScale(unit));
    if (Math.abs(f - this.hz) < 0.05) return;
    this.hz = f;
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(f, t, 0.15);
    this.osc2.frequency.setTargetAtTime(2 * f, t, 0.15);
  }

  /** A soft clay thud panned by screen x in [0, 1]. At most one per 60 ms. */
  thud(x01: number, nowMs: number): void {
    const c = this.ctx, m = this.master, noise = this.noise;
    if (!this.enabled || !c || !m || !noise || !this.limiter.allow(nowMs)) return;
    const t = c.currentTime;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(THUD_GAIN, t + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0001, t + THUD_S);
    const pan = c.createStereoPanner?.();
    if (pan) { pan.pan.value = panOf(x01); out.connect(pan); pan.connect(m); } else out.connect(m);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(72, t);
    o.frequency.exponentialRampToValueAtTime(44, t + THUD_S);
    o.connect(out);
    const src = c.createBufferSource();
    src.buffer = noise;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 260;
    const ng = c.createGain();
    ng.gain.value = 0.5;
    src.connect(lp); lp.connect(ng); ng.connect(out);
    o.start(t); src.start(t);
    o.stop(t + THUD_S + 0.05); src.stop(t + THUD_S + 0.05);
    this.thuds++;
  }

  /** A brief glassy chord: three detuned sines, 30 ms attack, 1.6 s decay. */
  chord(): void {
    const c = this.ctx, m = this.master;
    if (!this.enabled || !c || !m) return;
    const t = c.currentTime;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(CHORD_GAIN, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + CHORD_S);
    g.connect(m);
    for (const p of CHORD) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = p.hz;
      o.detune.value = p.cents;
      o.connect(g);
      o.start(t);
      o.stop(t + CHORD_S + 0.1);
    }
    this.chords++;
  }

  dispose(): void {
    if (this.suspendTimer !== undefined) clearTimeout(this.suspendTimer);
    this.enabled = false;
    try { this.osc1?.stop(); this.osc2?.stop(); } catch { /* not started */ }
    void this.ctx?.close().catch(() => {});
    this.ctx = undefined;
  }
}
