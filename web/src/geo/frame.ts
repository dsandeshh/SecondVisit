// Geo anchor transforms (agent6 4.1.1). Exact mirror of engine/dr/geo.py; change both or neither.
// plan_north_deg: direction of true north in the plan, degrees counterclockwise from plan +x.
// plan_pos is the plan position of the anchor lat/lon. mirror flips east (plan y down images).
import { clockHour } from "../clock";
import type { GeoAnchor, Vec2 } from "../types";

export type { GeoAnchor };
const R = 6378137;
const D2R = Math.PI / 180;

export function geoToEN(a: GeoAnchor, lat: number, lon: number): { e: number; n: number } {
  return { e: (lon - a.lon) * D2R * R * Math.cos(a.lat * D2R), n: (lat - a.lat) * D2R * R };
}

export function enToPlan(a: GeoAnchor, e: number, n: number): Vec2 {
  const t = a.plan_north_deg * D2R, s = a.mirror ? -1 : 1;
  return [a.plan_pos[0] + s * e * Math.sin(t) + n * Math.cos(t),
    a.plan_pos[1] - s * e * Math.cos(t) + n * Math.sin(t)];
}

export function planToEN(a: GeoAnchor, x: number, y: number): { e: number; n: number } {
  const t = a.plan_north_deg * D2R, s = a.mirror ? -1 : 1;
  const dx = x - a.plan_pos[0], dy = y - a.plan_pos[1];
  return { e: s * (dx * Math.sin(t) - dy * Math.cos(t)), n: dx * Math.cos(t) + dy * Math.sin(t) };
}

export function geoToPlan(a: GeoAnchor, lat: number, lon: number): Vec2 {
  const { e, n } = geoToEN(a, lat, lon);
  return enToPlan(a, e, n);
}

export function planToGeo(a: GeoAnchor, x: number, y: number): { lat: number; lon: number } {
  const { e, n } = planToEN(a, x, y);
  return { lat: a.lat + n / (D2R * R), lon: a.lon + e / (D2R * R * Math.cos(a.lat * D2R)) };
}

/** Compass bearing, clockwise from north, of an east/north offset. */
export const bearingDeg = (e: number, n: number): number => (Math.atan2(e, n) / D2R + 360) % 360;

/** Clock hour 12, 1 .. 11 of a target bearing seen facing `bearingFacing`; half to even like Python (clock.ts). */
export const clockOf = (bearingTarget: number, bearingFacing: number): number =>
  clockHour(((bearingTarget - bearingFacing + 540) % 360) - 180);

/** Compass bearing of a plan vector (dx, dy). */
export function planBearing(a: GeoAnchor, dx: number, dy: number): number {
  const { e, n } = planToEN({ ...a, plan_pos: [0, 0] }, dx, dy);
  return bearingDeg(e, n);
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R, p2 = lat2 * D2R;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((lon2 - lon1) * D2R / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Corners of a "POLYGON((lon lat, ...))" WKT, in lon/lat pairs (the closing vertex dropped). */
export function wktLonLat(wkt: string): Vec2[] {
  const m = /\(\((.*)\)\)/.exec(wkt);
  if (!m) return [];
  const pts = m[1].split(",").map(s => s.trim().split(/\s+/).map(Number) as Vec2).filter(p => p.length === 2 && p.every(Number.isFinite));
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  return pts;
}
