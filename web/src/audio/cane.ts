// The long cane: interpolated sweep, contact detection and the tap gate (Task 8, agent3 3.1).
import { CANE_M } from "../config";
import type { CellCode, Vec2 } from "../types";
import { dirOf, type World } from "../world";

export type Contact = { dist: number; code: CellCode; caneDeg: number; at: Vec2 };
export type TapEvent = Contact & { t: number };

/**
 * Cast rays from fromDeg to toDeg (relative to heading) every stepDeg, both ends included, so a fast
 * sweep cannot jump over a thin pillar. Returns the closest contact on the arc (ties: the first one
 * met), which is what the hand feels when the cane meets a surface mid sweep.
 */
export function sweepContact(world: World, origin: Vec2, heading: number, fromDeg: number, toDeg: number,
  maxM = CANE_M, stepDeg = 2): Contact | null {
  const span = toDeg - fromDeg;
  const n = Math.max(1, Math.ceil(Math.abs(span) / stepDeg));
  let best: Contact | null = null;
  for (let i = 0; i <= n; i++) {
    const cane = fromDeg + (span * i) / n;
    const hit = world.raycast(origin, heading + cane, maxM);
    if (hit && (!best || hit.dist < best.dist - 1e-9)) {
      const [dx, dy] = dirOf(heading + cane);
      best = { dist: hit.dist, code: hit.code, caneDeg: cane, at: [origin[0] + dx * hit.dist, origin[1] + dy * hit.dist] };
    }
  }
  return best;
}

/** Arc for the automatic sweep on step n: -30 to +30, alternating direction each step. */
export const autoSweep = (step: number): [number, number] => (step % 2 === 0 ? [-30, 30] : [30, -30]);

export const AUTO_SWEEP_MS = 350;
const GATE_MS = 60;
const NEW_SURFACE_M = 0.3;

/** Edge triggered: a tap when contact begins, the material changes, or the contact jumps > 0.3 m. 60 ms gate. */
export class TapGate {
  private prev: Contact | null = null;
  private lastTap = -Infinity;

  update(hit: Contact | null, tMs: number): TapEvent | null {
    const prev = this.prev;
    this.prev = hit;
    if (!hit) return null;
    const edge = !prev || prev.code !== hit.code ||
      Math.hypot(prev.at[0] - hit.at[0], prev.at[1] - hit.at[1]) > NEW_SURFACE_M;
    if (!edge || tMs - this.lastTap < GATE_MS) return null;
    this.lastTap = tMs;
    return { ...hit, t: tMs };
  }

  reset(): void { this.prev = null; }
}

/** Mild distance falloff inside the cane: 1 at the hand, 0.6 at CANE_M. */
export const tapGain = (d: number): number => 1 - 0.4 * Math.max(0, Math.min(1, d / CANE_M));
