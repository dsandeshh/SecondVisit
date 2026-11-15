// Outdoor step model (agent6 4.1.4). Pure: no three.js, no audio. The same 0.7 m step as inside; the building
// outline is a wall except through the door opening; the edge line and the canopy raise one event each time.
import { STEP_M } from "../../config";
import type { Vec2 } from "../../types";

export const DOOR_REACH_M = 1.0;   // inside this the traveller is at the door
export const DOOR_OPEN_HALF_M = 0.9; // half width of the opening in the wall in front of the door
export const DOOR_OPEN_LEN_M = 6;   // how far out from the door the opening reaches (past the outline)

export type OutdoorWorld = {
  outline: Vec2[] | null;          // the building outline: a wall
  canopy: Vec2[] | null;
  edge: [Vec2, Vec2] | null;       // the aisle/walkway edge line, only when the package has one
  door: Vec2;
  doorOut: Vec2;                   // unit vector from the door toward the street
};

export type StepResult = {
  pos: Vec2; blocked: boolean; crossedEdge: boolean; enteredCanopy: boolean; leftCanopy: boolean; atDoor: boolean;
};

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Proper crossing of segments ab and cd. */
export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function segmentCrossesPolygon(a: Vec2, b: Vec2, poly: Vec2[]): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segmentsCross(a, b, poly[j], poly[i])) return true;
  return false;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** In the opening of the wall in front of the door (so the walker can enter). */
export function inDoorOpening(w: OutdoorWorld, p: Vec2): boolean {
  const far: Vec2 = [w.door[0] + w.doorOut[0] * DOOR_OPEN_LEN_M, w.door[1] + w.doorOut[1] * DOOR_OPEN_LEN_M];
  return distToSegment(p, w.door, far) <= DOOR_OPEN_HALF_M;
}

export function inside(poly: Vec2[] | null, p: Vec2): boolean { return !!poly && poly.length > 2 && pointInPolygon(p, poly); }

/** One step of STEP_M along `heading` (0 = +y, clockwise). A step into the wall is a bump: the walker stays put. */
export function stepOutdoor(w: OutdoorWorld, pos: Vec2, heading: number, len = STEP_M): StepResult {
  const r = heading * Math.PI / 180;
  const next: Vec2 = [pos[0] + len * Math.sin(r), pos[1] + len * Math.cos(r)];
  const wasIn = inside(w.outline, pos);
  const wall = !!w.outline && w.outline.length > 2 && !wasIn && !inDoorOpening(w, next) &&
    (inside(w.outline, next) || segmentCrossesPolygon(pos, next, w.outline));
  const to = wall ? pos : next;
  const was = inside(w.canopy, pos), now = inside(w.canopy, to);
  return {
    pos: to, blocked: wall,
    crossedEdge: !wall && !!w.edge && segmentsCross(pos, to, w.edge[0], w.edge[1]),
    enteredCanopy: !was && now, leftCanopy: was && !now,
    atDoor: Math.hypot(to[0] - w.door[0], to[1] - w.door[1]) <= DOOR_REACH_M,
  };
}

export function worldOf(a: { door_plan?: Vec2 | null; building_outline_plan?: Vec2[] | null; canopy_plan?: Vec2[] | null;
  cues?: { kind: string; plan: Vec2[] }[] }, door: Vec2, entranceHeading: number): OutdoorWorld {
  const edge = a.cues?.find(c => c.kind === "edge" && c.plan.length >= 2);
  const out = (entranceHeading + 180) * Math.PI / 180; // street side: opposite the walking in direction
  return {
    outline: a.building_outline_plan ?? null, canopy: a.canopy_plan ?? null, door,
    edge: edge ? [edge.plan[0], edge.plan[edge.plan.length - 1]] : null,
    doorOut: [Math.sin(out), Math.cos(out)],
  };
}
