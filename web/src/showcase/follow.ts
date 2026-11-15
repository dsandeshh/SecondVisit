// Sweep chooser and the one-move-at-a-time follower (item 3). Line of sight uses World.raycast (world.ts).
import type { Vec2 } from "../types";
import { bearing, dist, wrap180, type World } from "../world";

export type PlanSweep = { id: string; plan: Vec2; enabled: boolean };

/** Max distance for a sweep to be worth showing; beyond it the picture would feel detached from the walker. */
export const MAX_SWEEP_M = 6;
/** Sweep ahead: within this cone of the walker's heading, this far, in clear sight. */
export const AHEAD_DEG = 60;
export const AHEAD_M = 2.5;
/** Keep the current sweep while it is at least this far ahead of the walker (about one step). */
export const LEAD_M = 0.7;
/** A new sweep must be at least this far ahead, so we never step back onto one we just passed. */
export const MIN_FWD_M = 0.3;
/** Moves longer than this (or the first placement) fly; shorter ones are walking steps. */
export const LONG_JUMP_M = 4;
export const STEP_MOVE_MS = 400;
export const LONG_MOVE_MS = 900;

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

/** The sweep AHEAD of the walker: within AHEAD_DEG of the heading, up to AHEAD_M, clear line of sight. Keeps the
 *  current sweep while it is still LEAD_M ahead; with nothing ahead it falls back to the nearest (chooseSweep). */
export function chooseSweepAhead(world: World, sweeps: PlanSweep[], pos: Vec2, headingDeg: number,
  currentId: string | null): string | null {
  const h = headingDeg * Math.PI / 180, fx = Math.sin(h), fy = Math.cos(h);
  const fwd = (p: Vec2): number => (p[0] - pos[0]) * fx + (p[1] - pos[1]) * fy;
  const cur = currentId ? sweeps.find(s => s.id === currentId && s.enabled) : undefined;
  const curOk = !!cur && dist(pos, cur.plan) <= MAX_SWEEP_M && clearLine(world, pos, cur.plan);
  const curFwd = cur && curOk ? fwd(cur.plan) : -Infinity;
  if (curFwd >= LEAD_M) return currentId;
  let best: { id: string; d: number } | null = null;
  for (const s of sweeps) {
    if (!s.enabled || s.id === currentId) continue;
    const d = dist(pos, s.plan), f = fwd(s.plan);
    if (d > AHEAD_M || f < MIN_FWD_M || f <= curFwd) continue;
    if (Math.abs(wrap180(bearing(pos, s.plan) - headingDeg)) > AHEAD_DEG) continue;
    if (!clearLine(world, pos, s.plan)) continue;
    if (!best || d < best.d) best = { id: s.id, d };
  }
  return best?.id ?? chooseSweep(world, sweeps, pos, currentId);
}

/** Walking steps blend in STEP_MOVE_MS; a long jump or the first placement is a longer fly. */
export function moveStyle(jumpM: number, first: boolean): { long: boolean; ms: number } {
  return first || jumpM > LONG_JUMP_M ? { long: true, ms: LONG_MOVE_MS } : { long: false, ms: STEP_MOVE_MS };
}

export type MoveInfo = { jumpM: number; first: boolean };

/** One move at a time, plus a queue of depth 1: a pose that arrives while a move is in flight replaces any queued
 *  pose (newest wins) and is followed as soon as the move lands, so holding Up chains moves instead of dropping them. */
export class SweepFollower {
  current: string | null = null;
  busy = false;
  moves = 0;
  queued = 0;
  lastMoveMs = 0;
  private pending: { pos: Vec2; heading: number } | null = null;
  constructor(private world: World, private sweeps: () => PlanSweep[],
    private move: (id: string, headingDeg: number, info: MoveInfo) => Promise<void>) {}

  async update(pos: Vec2, headingDeg: number): Promise<boolean> {
    if (this.busy) { this.pending = { pos, heading: headingDeg }; this.queued++; return false; }
    const all = this.sweeps();
    const id = chooseSweepAhead(this.world, all, pos, headingDeg, this.current);
    if (!id || id === this.current) return false;
    const from = all.find(s => s.id === this.current), to = all.find(s => s.id === id)!;
    const info: MoveInfo = { jumpM: from ? dist(from.plan, to.plan) : 0, first: this.current === null };
    this.busy = true;
    const t0 = Date.now();
    try { await this.move(id, headingDeg, info); this.current = id; this.moves++; }
    catch { /* a failed move leaves the current sweep; the next update retries */ }
    finally { this.busy = false; this.lastMoveMs = Date.now() - t0; }
    const next = this.pending; this.pending = null;
    if (next) await this.update(next.pos, next.heading);
    return true;
  }
}
