// Place picker order, beacon pulse maths and path (review/agent5_interaction.md 4.6). The scheduler is in Interact.
import { ARRIVE_M } from "../config";
import type { Vec2 } from "../types";
import { dist, type World } from "../world";
import { los, type Item } from "./sweep";

export const MAX_PULSE_S = 1.2, WAYPOINT_M = 1.0;
export const pulseInterval = (d: number): number => Math.min(MAX_PULSE_S, 0.25 + 0.15 * Math.max(0, d)); // Hearify
export type PulseKind = "pulseOn" | "pulse" | "pulseBehind";
/** Soundscape bands: on axis within 15 degrees, behind past 125 (agent5 4.6). */
export function pulseKind(azDeg: number): PulseKind {
  const a = Math.abs(azDeg);
  return a <= 15 ? "pulseOn" : a <= 125 ? "pulse" : "pulseBehind";
}

/** The furthest waypoint still in line of sight (corners already seen are skipped), else the next one. */
export function beaconPoint(path: Vec2[], pos: Vec2, target: Vec2, world: World): Vec2 {
  for (let i = path.length - 1; i >= 0; i--) if (los(world, pos, path[i])) return path[i];
  return path[0] ?? target;
}

/** Tab order: the ids in `first` in that order (route destinations, then entrances), then exits and doors, desk,
 *  restroom, elevator, then by distance (recomputed per press). A single id is today's destination. */
export function targetOrder(items: Item[], pos: Vec2, first?: string | string[]): Item[] {
  const lead = typeof first === "string" ? [first] : first ?? [];
  const rank = (i: Item): number => lead.includes(i.id) ? -100 + lead.indexOf(i.id)
    : i.kind === "entrance" || i.kind === "door" || i.kind === "glass_door" ? 1
    : i.kind === "desk" ? 2 : i.kind === "restroom" ? 3 : i.kind === "elevator" ? 4 : 5;
  return [...items].sort((a, b) => rank(a) - rank(b) || dist(pos, a.at) - dist(pos, b.at));
}

/** After a Tab press: the next (or previous) item in the order, wrapping; the first when nothing is picked. */
export function nextPick(order: Item[], current: string | null, dir: 1 | -1): Item | null {
  if (!order.length) return null;
  const i = order.findIndex(o => o.id === current);
  if (i < 0) return dir === 1 ? order[0] : order[order.length - 1];
  return order[(i + dir + order.length) % order.length];
}

/** True when every cell on the straight line from p to q is free (walls, obstacles and glass all block). */
export const clearLine = (world: World, p: Vec2, q: Vec2): boolean => clear(world, p, q);
/** The furthest path corner the walker can walk to in a straight line, else the first one. */
export function walkPoint(path: Vec2[], pos: Vec2, world: World): Vec2 {
  for (let i = path.length - 1; i >= 0; i--) if (clear(world, pos, path[i])) return path[i];
  return path[0];
}

function clear(world: World, p: Vec2, q: Vec2): boolean {
  const n = Math.ceil(dist(p, q) / 0.1);
  for (let i = 1; i < n; i++) { const t = i / n; if (world.cellAt([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]) !== 0) return false; }
  return true;
}

/** A* on the grid (8 connected, coarse first) from pos to the target, then string pulled to corners. null: no path. */
export function findPath(world: World, from: Vec2, to: Vec2): Vec2[] | null {
  if (clear(world, from, to)) return [to];
  for (const k of [2, 1]) {
    const p = astar(world, from, to, k);
    if (p) return pull(world, from, p);
  }
  return null;
}

function astar(world: World, from: Vec2, to: Vec2, k: number): Vec2[] | null {
  const res = world.res * k, W = Math.ceil(world.w / k), H = Math.ceil(world.h / k);
  const blocked = new Uint8Array(W * H);
  for (let r = 0; r < world.h; r++) for (let c = 0; c < world.w; c++) if (world.cells[r * world.w + c] !== 0) blocked[Math.floor(r / k) * W + Math.floor(c / k)] = 1;
  const idx = (p: Vec2): number => {
    const c = Math.min(W - 1, Math.max(0, Math.floor((p[0] - world.origin[0]) / res))), r = Math.min(H - 1, Math.max(0, Math.floor((p[1] - world.origin[1]) / res)));
    return r * W + c;
  };
  const centre = (i: number): Vec2 => [world.origin[0] + ((i % W) + 0.5) * res, world.origin[1] + (Math.floor(i / W) + 0.5) * res];
  const s = idx(from), g = idx(to);
  blocked[s] = 0; blocked[g] = 0;
  const gs = new Float32Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
  const open: [number, number][] = [[0, s]]; gs[s] = 0;
  const h = (i: number) => dist(centre(i), centre(g));
  let guard = 0;
  while (open.length && guard++ < 400000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, cur] = open.splice(bi, 1)[0];
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === g) {
      const out: Vec2[] = []; for (let i = g; i !== -1; i = prev[i]) out.push(centre(i));
      return out.reverse();
    }
    const cx = cur % W, cy = Math.floor(cur / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (blocked[n] || closed[n]) continue;
      if (dx && dy && (blocked[cy * W + nx] || blocked[ny * W + cx])) continue; // no corner cutting
      const ng = gs[cur] + (dx && dy ? 1.4142 : 1);
      if (ng < gs[n]) { gs[n] = ng; prev[n] = cur; open.push([ng + h(n), n]); }
    }
  }
  return null;
}

/** Keep only the corners: from each point jump to the furthest point still straight and clear. */
function pull(world: World, from: Vec2, pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  let cur = from, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clear(world, cur, pts[j])) j--;
    out.push(pts[j]); cur = pts[j]; i = j + 1;
  }
  return out;
}

export { ARRIVE_M };
