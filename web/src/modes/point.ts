// Pointing task after arrival (Task 10 web, v2). No hint before confirm: only the heading is ever shown.
import { closeness } from "./guide";
import { clockHour } from "../clock";
import { spokenOf } from "../names";
import type { Landmark, PointResult, Vec2 } from "../types";
import { bearing, wrap180, wrap360 } from "../world";

export { bearing };
export const POINT_TURN_DEG = 5;
export const RATCHET_DEG = 15;

/** Smallest angle between two compass headings, in [0, 180]. */
export function angularError(a: number, b: number): number {
  return Math.abs(wrap180(a - b));
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export class PointTask {
  heading: number;
  readonly targetBearing: number;
  private turned = 0;
  private t0 = 0;
  done = false;

  constructor(readonly from: Vec2, readonly startHeading: number, readonly target: Landmark,
    private onTick: () => void = () => {}) {
    this.heading = wrap360(startHeading);
    this.targetBearing = bearing(from, target.pos);
  }

  /** Spoken intro. Never mentions where the target is. */
  start(say: (t: string, pri?: 0 | 1 | 2 | 3) => void, tMs = 0): void {
    this.t0 = tMs;
    say(`You are back at the entrance, facing into the building. Turn to face the ${lower(spokenOf(this.target))}, then press Space.`, 2);
  }

  turn(deg: number): void {
    if (this.done || !Number.isFinite(deg)) return;
    const prev = this.turned;
    this.turned += deg;
    this.heading = wrap360(this.startHeading + this.turned);
    if (Math.floor(prev / RATCHET_DEG) !== Math.floor(this.turned / RATCHET_DEG)) this.onTick();
  }

  /** Heading as a clock hour relative to facing into the building (12 = straight ahead). */
  clock(): number { return clockHour(wrap180(this.heading - this.startHeading)); }

  confirm(tMs: number): PointResult {
    this.done = true;
    return {
      at: [this.from[0], this.from[1]], target: this.target.id, heading: this.heading,
      target_bearing: this.targetBearing, error_deg: angularError(this.heading, this.targetBearing),
      time_s: Math.round(tMs - this.t0) / 1000,
    };
  }
}

export function pointFeedback(r: PointResult, startHeading: number, label: string): string {
  const h = clockHour(wrap180(r.target_bearing - startHeading));
  return `You were ${Math.round(r.error_deg)} degrees off. ${closeness(Math.round(r.error_deg))} The ${lower(label)} is at ${h} o'clock from here.`;
}
