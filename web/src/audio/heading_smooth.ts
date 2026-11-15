// The ear (audio listener) and the 3D camera turn smoothly: each turn press glides from wherever the ear is now to the
// new stepped heading over TURN_GLIDE_MS (ease out, along the short way round, never overshooting), so the beacon sweeps
// past instead of jumping 15 degrees. The walker's logical heading stays stepped.
import { wrap180, wrap360 } from "../world";

export const TURN_GLIDE_MS = 150;

export class HeadingSmoother {
  private from = 0;
  private to = 0;
  private t0 = -Infinity;
  constructor(h = 0, readonly ms = TURN_GLIDE_MS) { this.snap(h); }

  /** Jump straight to h (placing the walker, phone yaw). */
  snap(h: number): void { this.from = this.to = wrap360(h); this.t0 = -Infinity; }

  /** A new stepped heading at time `now` (ms): glide there from the current value. */
  set(h: number, now: number): void {
    if (wrap360(h) === this.to) return;
    this.from = this.at(now); this.to = wrap360(h); this.t0 = now;
  }

  /** The heading at time `now` (ms), [0, 360). */
  at(now: number): number {
    const k = Math.max(0, Math.min(1, (now - this.t0) / this.ms));
    if (k >= 1) return this.to;
    const e = 1 - (1 - k) * (1 - k);
    return wrap360(this.from + wrap180(this.to - this.from) * e);
  }

  get target(): number { return this.to; }
}
