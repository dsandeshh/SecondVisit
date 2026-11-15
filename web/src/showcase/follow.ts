// Sweep chooser and the one-move-at-a-time follower (item 3). Line of sight uses World.raycast (world.ts).
import type { Vec2 } from "../types";
import { bearing, dist, type World } from "../world";

export type PlanSweep = { id: string; plan: Vec2; enabled: boolean };

/** Max distance for a sweep to be worth showing; beyond it the picture would feel detached from the walker. */
export const MAX_SWEEP_M = 6;
/** Hysteresis: keep the current sweep unless a new one is this much closer. */
export const SWITCH_GAIN_M = 0.6;

export function clearLine(world: World, a: Vec2, b: Vec2): boolean {
  const d = dist(a, b);
  if (d < 0.1) return true;
  return world.raycast(a, bearing(a, b), Math.max(0, d - 0.1)) === null;
}

/** Nearest enabled sweep with a clear line of sight; keeps `currentId` while it is still good. */
export function chooseSweep(world: World, sweeps: PlanSweep[], pos: Vec2, currentId: string | null,
  maxM = MAX_SWEEP_M): string | null {
  let best: { id: string; d: number } | null = null;
  let cur: { id: string; d: number } | null = null;
  for (const s of sweeps) {
    if (!s.enabled) continue;
    const d = dist(pos, s.plan);
    if (d > maxM || !clearLine(world, pos, s.plan)) continue;
    if (s.id === currentId) cur = { id: s.id, d };
    if (!best || d < best.d) best = { id: s.id, d };
  }
  if (cur && best && cur.d <= best.d + SWITCH_GAIN_M) return cur.id;
  return best?.id ?? cur?.id ?? null;
}

/** Calls `move` at most once at a time; calls made while a move is in flight are dropped (never queued). */
export class SweepFollower {
  current: string | null = null;
  busy = false;
  moves = 0;
  lastMoveMs = 0;
  constructor(private world: World, private sweeps: () => PlanSweep[],
    private move: (id: string, headingDeg: number) => Promise<void>) {}

  async update(pos: Vec2, headingDeg: number): Promise<boolean> {
    if (this.busy) return false;
    const id = chooseSweep(this.world, this.sweeps(), pos, this.current);
    if (!id || id === this.current) return false;
    this.busy = true;
    const t0 = Date.now();
    try { await this.move(id, headingDeg); this.current = id; this.moves++; }
    catch { /* a failed move leaves the current sweep; the next update retries */ }
    finally { this.busy = false; this.lastMoveMs = Date.now() - t0; }
    return true;
  }
}
