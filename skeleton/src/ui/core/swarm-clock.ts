// Swarm_Clock: the virtual time the ghost swarm plays on, in seconds. Bullet time lowers its rate; the timeline
// scrubber seeks and freezes it. Pure.
export class SwarmClock {
  now = 0;
  rate = 1;
  frozen = false;

  /** Advances by rate × dt seconds of wall time (never backward), unless frozen. */
  advance(dtWall: number): void {
    if (this.frozen || !(dtWall > 0) || !(this.rate > 0)) return;
    this.now += this.rate * dtWall;
  }

  /** Sets the time and freezes it. */
  seek(t: number): void {
    if (Number.isFinite(t)) this.now = t;
    this.frozen = true;
  }

  freeze(): void { this.frozen = true; }
  play(): void { this.frozen = false; }
}
