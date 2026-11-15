// Plan geometry: occupancy grid, ray casts, rooms, and the traveller (Task 8).
import { STEP_M } from "./config";
import type { BuildingPackage, CellCode, Room, Vec2 } from "./types";

export const wrap360 = (d: number): number => ((d % 360) + 360) % 360;
/** Wrap to (-180, 180]. */
export const wrap180 = (d: number): number => { const w = wrap360(d + 180) - 180; return w === -180 ? 180 : w; };
export const dirOf = (deg: number): Vec2 => [Math.sin(deg * Math.PI / 180), Math.cos(deg * Math.PI / 180)];
/** Compass bearing from a to b: 0 = +y, clockwise. */
export const bearing = (a: Vec2, b: Vec2): number =>
  wrap360(Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function decodeCells(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function inPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export type Hit = { dist: number; code: CellCode };
const RAY_STEP = 0.05;

export class World {
  readonly cells: Uint8Array;
  readonly res: number;
  readonly w: number;
  readonly h: number;
  readonly origin: Vec2;

  constructor(readonly pkg: BuildingPackage) {
    const g = pkg.grid;
    this.cells = decodeCells(g.cells_b64);
    this.res = g.res; this.w = g.width; this.h = g.height; this.origin = g.origin;
    if (this.cells.length !== g.width * g.height) throw new Error("grid size does not match cells");
  }

  inBounds(p: Vec2): boolean {
    const c = (p[0] - this.origin[0]) / this.res, r = (p[1] - this.origin[1]) / this.res;
    return c >= 0 && r >= 0 && c < this.w && r < this.h;
  }

  /** Off the grid counts as wall, so nothing walks off it. */
  cellAt(p: Vec2): CellCode {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !this.inBounds(p)) return 1;
    const c = Math.floor((p[0] - this.origin[0]) / this.res), r = Math.floor((p[1] - this.origin[1]) / this.res);
    return this.cells[r * this.w + c] as CellCode;
  }

  /** First non free cell along the ray (0.05 m steps), or null if free to maxM or the ray leaves the grid. */
  raycast(origin: Vec2, deg: number, maxM: number): Hit | null {
    const [dx, dy] = dirOf(deg);
    for (let t = RAY_STEP; t <= maxM + 1e-9; t += RAY_STEP) {
      const p: Vec2 = [origin[0] + dx * t, origin[1] + dy * t];
      if (!this.inBounds(p)) return null;
      const code = this.cellAt(p);
      if (code !== 0) return { dist: Math.round(t * 1000) / 1000, code };
    }
    return null;
  }

  roomAt(p: Vec2): Room | null {
    return this.pkg.rooms.find(r => inPolygon(p, r.polygon)) ?? null;
  }

  /** Floor area used for reverb when no room contains the traveller. */
  areaAt(p: Vec2): number {
    return this.roomAt(p)?.area_m2 ?? this.w * this.h * this.res * this.res;
  }
}

export class Traveller {
  pos: Vec2;
  heading: number;
  caneDeg = 0;

  constructor(readonly world: World, pos: Vec2, heading: number) {
    this.pos = [pos[0], pos[1]];
    this.heading = wrap360(heading);
  }

  /** One STEP_M step forward (1) or back (-1). A bump leaves pos unchanged; the caller plays the tap. */
  step(dir: 1 | -1): "ok" | "bump" {
    const [dx, dy] = dirOf(this.heading);
    const to: Vec2 = [this.pos[0] + dir * dx * STEP_M, this.pos[1] + dir * dy * STEP_M];
    if (!Number.isFinite(to[0]) || !Number.isFinite(to[1])) return "bump";
    for (let t = RAY_STEP; t <= STEP_M + 1e-9; t += RAY_STEP) {
      const p: Vec2 = [this.pos[0] + dir * dx * t, this.pos[1] + dir * dy * t];
      if (this.world.cellAt(p) !== 0) return "bump";
    }
    this.pos = to;
    return "ok";
  }

  turn(deg: number): void {
    if (Number.isFinite(deg)) this.heading = wrap360(this.heading + deg);
  }

  setHeading(deg: number): void {
    if (Number.isFinite(deg)) this.heading = wrap360(deg);
  }

  /** Cane angle relative to heading, clamped to ±50 degrees. */
  setCane(deg: number): void {
    this.caneDeg = Number.isFinite(deg) ? Math.max(-50, Math.min(50, deg)) : 0;
  }
}
