// Collision thud plus name (review/agent5_interaction.md 4.7). Pure: what was hit, and whether to say its name again.
import { STEP_M } from "../config";
import type { Door, Vec2 } from "../types";
import { dist, dirOf, type World } from "../world";
import type { Item } from "./sweep";

export const BUMP_REPEAT_MS = 2000, DOOR_REACH_M = 0.5, NAME_REACH_M = 1.0;

export type Bump = { at: Vec2; label: string; key: string; code: number; may_move: boolean; pri: 2 | 3 };

function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** What a blocked step ran into: the first non free cell along the step ray. Never guesses a name for an unlabelled obstacle. */
export function bumpOf(world: World, pos: Vec2, headingDeg: number, items: Item[], doors: Door[] = []): Bump | null {
  const hit = world.raycast(pos, headingDeg, STEP_M + 0.3);
  if (!hit) return null;
  const [dx, dy] = dirOf(headingDeg);
  const at: Vec2 = [pos[0] + dx * hit.dist, pos[1] + dy * hit.dist];
  const key = `${hit.code}@${Math.round(at[0] / 0.5)},${Math.round(at[1] / 0.5)}`;
  if (doors.some(d => distToSeg(at, d.a, d.b) <= DOOR_REACH_M)) return { at, label: "door", key, code: hit.code, may_move: false, pri: 2 };
  if (hit.code === 1) return { at, label: "wall", key, code: 1, may_move: false, pri: 2 };
  if (hit.code === 4) return { at, label: "glass", key, code: 4, may_move: false, pri: 2 };
  if (hit.code === 5) return { at, label: "stairs", key, code: 5, may_move: false, pri: 3 };
  const near = items.filter(i => dist(i.at, at) <= NAME_REACH_M).sort((a, b) => dist(a.at, at) - dist(b.at, at))[0];
  return near ? { at, label: near.name, key, code: hit.code, may_move: !near.fixed, pri: 2 }
    : { at, label: "obstacle", key, code: hit.code, may_move: false, pri: 2 };
}

/** The same blocker within 2 s gets the thud only. */
export class BumpGate {
  private last = new Map<string, number>();
  shouldName(key: string, now: number): boolean {
    const t = this.last.get(key);
    if (t !== undefined && now - t <= BUMP_REPEAT_MS) return false;
    this.last.set(key, now);
    return true;
  }
}
