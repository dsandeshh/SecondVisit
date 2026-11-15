// Room size, room entry and doorways (review/agent5_interaction.md 4.9, 4.11). Pure.
import { t60ForArea } from "../audio/echo";
import type { Door, Room, Vec2 } from "../types";
import { dist } from "../world";

/** Convex hull (monotone chain). */
export function hull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Vec2[] = [], up: Vec2[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** Minimum area bounding rectangle (rotating calipers: one side lies on a hull edge), long side first, in metres. */
export function roomSize(polygon: Vec2[]): [number, number] {
  const h = hull(polygon);
  if (h.length < 3) return [0, 0];
  let best: [number, number] = [Infinity, Infinity], area = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], l = dist(a, b);
    if (l === 0) continue;
    const ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of h) {
      const u = (q[0] - a[0]) * ux + (q[1] - a[1]) * uy, v = -(q[0] - a[0]) * uy + (q[1] - a[1]) * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const w = u1 - u0, d = v1 - v0;
    if (w * d < area) { area = w * d; best = [w, d]; }
  }
  return best[0] >= best[1] ? best : [best[1], best[0]];
}

/** "Waiting room, about 8 by 6 metres." */
export function roomLine(room: Room): string {
  const [l, w] = roomSize(room.polygon);
  return `${room.label}, about ${Math.round(l)} by ${Math.round(w)} metres.`;
}
export const echoSeconds = (room: Room): number => Math.round(t60ForArea(room.area_m2) * 10) / 10;

const side = (p: Vec2, a: Vec2, b: Vec2): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

/** Did the move from p to q pass through the door segment a-b (sign change of the cross product, inside the jambs)? */
export function crossesDoor(p: Vec2, q: Vec2, d: Door): boolean {
  const s1 = side(p, d.a, d.b), s2 = side(q, d.a, d.b);
  if (s1 === 0 && s2 === 0) return false;
  if ((s1 > 0) === (s2 > 0) && s1 !== 0 && s2 !== 0) return false;
  const t = s1 / (s1 - s2);                                  // where along p->q the line is crossed
  const x: Vec2 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const l = dist(d.a, d.b);
  const along = ((x[0] - d.a[0]) * (d.b[0] - d.a[0]) + (x[1] - d.a[1]) * (d.b[1] - d.a[1])) / (l * l);
  return along >= -0.2 && along <= 1.2;
}

/**
 * Room entry: a door crossing announces the new room at once; without a door (open plan) the new room must hold for
 * two consecutive steps. Returns the room to announce, or null.
 */
export class RoomTracker {
  current: string | null = null;
  private cand: string | null = null;
  private n = 0;
  /** Call once per step with where the walker is now, whether a door was crossed, and the room there (null: in a doorway). */
  step(room: Room | null, crossed: boolean): Room | null {
    if (!room) return null;                      // a doorway keeps the old room
    if (room.id === this.current) { this.cand = null; this.n = 0; return null; }
    if (this.current === null || crossed) { this.current = room.id; this.cand = null; this.n = 0; return room; }
    if (this.cand === room.id) this.n++; else { this.cand = room.id; this.n = 1; }
    if (this.n >= 2) { this.current = room.id; this.cand = null; this.n = 0; return room; }
    return null;
  }
}

/** One announcement per approach: fires when d falls inside `near`, re-arms when d rises past `far`; global gap in ms. */
export class ApproachTracker {
  private armed = new Map<string, boolean>();
  private lastAt = -Infinity;
  constructor(private near: number, private far: number, private gapMs = 0) {}
  /** True when `id` should be announced now. `claim` false peeks without consuming (the caller may speak something else). */
  check(id: string, d: number, now: number, claim = true): boolean {
    const armed = this.armed.get(id) ?? true;
    if (d > this.far) { this.armed.set(id, true); return false; }
    if (!armed || d > this.near || now - this.lastAt < this.gapMs) return false;
    if (claim) { this.armed.set(id, false); this.lastAt = now; }
    return true;
  }
  reset(): void { this.armed.clear(); this.lastAt = -Infinity; }
}
