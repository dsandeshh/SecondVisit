// Around me (Q) and Ahead of me (E): which things, in what order (review/agent5_interaction.md 4.4, 4.5). Pure: no audio.
import { clockHour } from "../clock";
import { ARRIVE_M, STEP_M } from "../config";
import { isPossibly, spokenOf } from "../names";
import type { BuildingPackage, Landmark, Vec2 } from "../types";
import { bearing, dist, wrap180, type World } from "../world";

export const SWEEP_R_M = 8, SWEEP_MAX = 6, GROUP_M = 1.5, SWEEP_GAP_MS = 250;
export const AHEAD_R_M = 12, AHEAD_MAX = 5, AHEAD_HALF_DEG = 30;

/** Plural words per kind (mirror of engine/dr/names.py KIND_PLURAL). */
export const KIND_PLURAL: Record<string, string> = {
  desk: "desks", elevator: "elevators", stairs: "stairs", door: "doors", glass_door: "glass doors", seating: "chairs",
  restroom: "restrooms", sign: "signs", pillar: "pillars", water: "water fountains", other: "objects", chair: "chairs",
  entrance: "entrances",
};

/** A landmark, a door (midpoint) or an entrance, as the interactions see it. */
export type Item = { id: string; kind: string; at: Vec2; name: string; possibly: boolean; fixed: boolean };
export type SweepItem = Item & { az: number; d: number; count: number };

export function itemsOf(pkg: BuildingPackage): Item[] {
  const out: Item[] = pkg.landmarks.map((l: Landmark) => ({
    id: l.id, kind: l.kind, at: l.pos, name: spokenOf(l), possibly: isPossibly(l), fixed: l.fixed }));
  for (const e of pkg.entrances) out.push({ id: e.id, kind: "entrance", at: e.pos, name: e.label, possibly: false, fixed: true });
  const hasDoor = (p: Vec2) => out.some(i => (i.kind === "door" || i.kind === "glass_door") && dist(i.at, p) < 1);
  for (const d of pkg.doors ?? []) {
    const mid: Vec2 = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
    if (!hasDoor(mid)) out.push({ id: d.id, kind: "door", at: mid, name: "door", possibly: false, fixed: true });
  }
  return out;
}

/** Walk from p to q at 0.1 m; walls (code 1) block, glass does not (agent5 section 3 conventions). */
export function los(world: World, p: Vec2, q: Vec2): boolean {
  const d = dist(p, q), n = Math.ceil(d / 0.1);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (world.cellAt([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]) === 1) return false;
  }
  return true;
}

export const sameRoom = (world: World, a: Vec2, b: Vec2): boolean => {
  const ra = world.roomAt(a), rb = world.roomAt(b);
  return !!ra && !!rb && ra.id === rb.id;
};

export const azOf = (pos: Vec2, heading: number, at: Vec2): number => wrap180(bearing(pos, at) - heading);
const cw = (az: number) => ((az % 360) + 360) % 360; // clockwise from straight ahead, [0, 360)
export const stepsOf = (d: number): number => Math.round(d / STEP_M);
export const stepsWords = (d: number): string => (stepsOf(d) < 1 ? "within reach" : stepsOf(d) === 1 ? "1 step" : `${stepsOf(d)} steps`);

/** Single link groups of the same kind within `GROUP_M` (Hearify scan.ts); a group of two or more is said as the plural. */
export function groupByKind(items: Item[], gap = GROUP_M): Item[][] {
  const seen = new Set<number>(), groups: Item[][] = [];
  items.forEach((_, i) => {
    if (seen.has(i)) return;
    const g: Item[] = [], stack = [i]; seen.add(i);
    while (stack.length) {
      const k = stack.pop()!; g.push(items[k]);
      items.forEach((o, j) => { if (!seen.has(j) && o.kind === items[k].kind && dist(o.at, items[k].at) <= gap) { seen.add(j); stack.push(j); } });
    }
    groups.push(g);
  });
  return groups;
}

function merge(g: Item[], pos: Vec2, heading: number): SweepItem {
  const at: Vec2 = [g.reduce((a, i) => a + i.at[0], 0) / g.length, g.reduce((a, i) => a + i.at[1], 0) / g.length];
  const first = g[0];
  return { ...first, at, count: g.length, name: g.length > 1 ? (KIND_PLURAL[first.kind] ?? "objects") : first.name,
    possibly: g.length === 1 && first.possibly, az: azOf(pos, heading, at), d: dist(pos, at) };
}

/** The 6 nearest groups within 8 m that the walker could hear in the room or see, clockwise from straight ahead. */
export function sweepItems(items: Item[], pos: Vec2, heading: number, world: World): SweepItem[] {
  const visible = items.filter(i => dist(pos, i.at) <= SWEEP_R_M && (sameRoom(world, pos, i.at) || los(world, pos, i.at)));
  const groups = groupByKind(visible).map(g => merge(g, pos, heading));
  return groups.sort((a, b) => a.d - b.d).slice(0, SWEEP_MAX).sort((a, b) => cw(a.az) - cw(b.az));
}

/** Items inside the 60 degree cone ahead within 12 m, nearest first, at most 5. */
export function aheadItems(items: Item[], pos: Vec2, heading: number, world: World): SweepItem[] {
  return items
    .filter(i => dist(pos, i.at) <= AHEAD_R_M && Math.abs(azOf(pos, heading, i.at)) <= AHEAD_HALF_DEG && (sameRoom(world, pos, i.at) || los(world, pos, i.at)))
    .map(i => ({ ...i, count: 1, az: azOf(pos, heading, i.at), d: dist(pos, i.at) }))
    .sort((a, b) => a.d - b.d).slice(0, AHEAD_MAX);
}

/** "Wall ahead in 6 steps." / "Open for at least 17 steps." from one raycast along the heading. */
export function aheadLine(world: World, pos: Vec2, heading: number, nearName?: (p: Vec2) => string | null): { text: string; pri: 2 | 3; hit_m: number } {
  const hit = world.raycast(pos, heading, AHEAD_R_M);
  if (!hit) return { text: `Open for at least ${stepsOf(AHEAD_R_M)} steps.`, pri: 2, hit_m: AHEAD_R_M };
  const n = stepsWords(hit.dist), inn = hit.dist < 0.7 ? "within reach" : `in ${n}`;
  if (hit.code === 1) return { text: `Wall ahead ${inn}.`, pri: 2, hit_m: hit.dist };
  if (hit.code === 4) return { text: `Glass ahead ${inn}.`, pri: 2, hit_m: hit.dist };
  if (hit.code === 5) return { text: `Stairs ahead ${inn}.`, pri: 3, hit_m: hit.dist };
  const at: Vec2 = [pos[0] + Math.sin(heading * Math.PI / 180) * hit.dist, pos[1] + Math.cos(heading * Math.PI / 180) * hit.dist];
  const nm = nearName?.(at);
  return { text: nm ? `${nm} ahead ${inn}.` : `Something in the way ${inn}.`, pri: 2, hit_m: hit.dist };
}

export const ARRIVED_M = ARRIVE_M;
export const clockWords = (az: number): string => `${clockHour(az)} o'clock`;
