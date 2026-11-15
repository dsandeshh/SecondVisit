// Frame calibration: Showcase SDK world (Y up, camera yaw 0 looks down -z) -> our plan frame (CLAUDE.md rule 3).
// Known convention: plan = (sdk.x, -sdk.z). We still FIT rotation about the vertical + translation from the
// sweep positions, and test a mirror, because the SDK frame may carry an alignment yaw and rule 3 forbids guessing.
import type { Vec2 } from "../types";

export type SdkPoint = { id: string; x: number; z: number };
export type PlanPoint = { id: string; x: number; y: number };

export interface Calibration {
  /** Rotation (deg, counter-clockwise seen from above) applied to u = (sdk.x, -sdk.z) after the optional mirror. */
  rotDeg: number;
  /** True only if the best fit needs a reflection of u (x negated) on top of the Y-up to Z-up change. */
  mirrored: boolean;
  tx: number; ty: number;
  meanErr: number; maxErr: number;
  matched: number;
  method: "ids" | "nearest";
}

const RAD = Math.PI / 180;

function procrustes(a: Vec2[], b: Vec2[]): { th: number; tx: number; ty: number; err: number[] } {
  const n = a.length;
  const ca: Vec2 = [a.reduce((s, p) => s + p[0], 0) / n, a.reduce((s, p) => s + p[1], 0) / n];
  const cb: Vec2 = [b.reduce((s, p) => s + p[0], 0) / n, b.reduce((s, p) => s + p[1], 0) / n];
  let sd = 0, sc = 0;
  for (let i = 0; i < n; i++) {
    const ax = a[i][0] - ca[0], ay = a[i][1] - ca[1], bx = b[i][0] - cb[0], by = b[i][1] - cb[1];
    sd += ax * bx + ay * by; sc += ax * by - ay * bx;
  }
  const th = Math.atan2(sc, sd), c = Math.cos(th), s = Math.sin(th);
  const tx = cb[0] - (c * ca[0] - s * ca[1]), ty = cb[1] - (s * ca[0] + c * ca[1]);
  const err = a.map((p, i) => Math.hypot(c * p[0] - s * p[1] + tx - b[i][0], s * p[0] + c * p[1] + ty - b[i][1]));
  return { th, tx, ty, err };
}

const mean = (v: number[]): number => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);

function fitPairs(u: Vec2[], b: Vec2[]): { mirrored: boolean; th: number; tx: number; ty: number; err: number[] } {
  const proper = procrustes(u, b);
  const refl = procrustes(u.map(p => [-p[0], p[1]] as Vec2), b);
  // Prefer the proper fit unless the mirror is clearly better (needed to say "mirrored" honestly).
  if (mean(refl.err) < 0.5 * mean(proper.err) && mean(proper.err) > 0.05) return { mirrored: true, ...refl };
  return { mirrored: false, ...proper };
}

/** Fit SDK sweeps onto Model API panorama positions. Matches by id; falls back to nearest neighbours (ICP). */
export function fitCalibration(sdk: SdkPoint[], plan: PlanPoint[]): Calibration | null {
  const byId = new Map(plan.map(p => [p.id, p]));
  const pairs = sdk.filter(s => byId.has(s.id)).map(s => ({ s, p: byId.get(s.id)! }));
  if (pairs.length >= 3) {
    const u = pairs.map(q => [q.s.x, -q.s.z] as Vec2), b = pairs.map(q => [q.p.x, q.p.y] as Vec2);
    return result(fitPairs(u, b), pairs.length, "ids");
  }
  if (sdk.length < 3 || plan.length < 3) return null;
  // ids differ: brute force the yaw (both mirrors), centroid align, nearest neighbour, then refine.
  const u0 = sdk.map(s => [s.x, -s.z] as Vec2), b0 = plan.map(p => [p.x, p.y] as Vec2);
  const cen = (v: Vec2[]): Vec2 => [mean(v.map(p => p[0])), mean(v.map(p => p[1]))];
  let best: { score: number; mir: boolean; deg: number } | null = null;
  for (const mir of [false, true]) {
    const u = mir ? u0.map(p => [-p[0], p[1]] as Vec2) : u0;
    const cu = cen(u), cb = cen(b0);
    for (let deg = 0; deg < 360; deg += 1) {
      const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
      let sc = 0;
      for (const p of u) {
        const x = c * (p[0] - cu[0]) - s * (p[1] - cu[1]) + cb[0], y = s * (p[0] - cu[0]) + c * (p[1] - cu[1]) + cb[1];
        sc += Math.min(...b0.map(q => Math.hypot(q[0] - x, q[1] - y)));
      }
      if (!best || sc < best.score) best = { score: sc, mir, deg };
    }
  }
  let u = best!.mir ? u0.map(p => [-p[0], p[1]] as Vec2) : u0;
  const cu = cen(u), cb = cen(b0);
  let th = best!.deg * RAD, tx = 0, ty = 0;
  let cur = u.map(p => [Math.cos(th) * (p[0] - cu[0]) - Math.sin(th) * (p[1] - cu[1]) + cb[0],
    Math.sin(th) * (p[0] - cu[0]) + Math.cos(th) * (p[1] - cu[1]) + cb[1]] as Vec2);
  let fit = procrustes(u, cur.map(p => nearest(p, b0)));
  for (let it = 0; it < 12; it++) {
    const c = Math.cos(fit.th), s = Math.sin(fit.th);
    cur = u.map(p => [c * p[0] - s * p[1] + fit.tx, s * p[0] + c * p[1] + fit.ty] as Vec2);
    fit = procrustes(u, cur.map(p => nearest(p, b0)));
  }
  ({ th, tx, ty } = fit);
  return result({ mirrored: best!.mir, th, tx, ty, err: fit.err }, u.length, "nearest");
}

function nearest(p: Vec2, set: Vec2[]): Vec2 {
  let b = set[0], d = Infinity;
  for (const q of set) { const e = Math.hypot(q[0] - p[0], q[1] - p[1]); if (e < d) { d = e; b = q; } }
  return b;
}

function result(f: { mirrored: boolean; th: number; tx: number; ty: number; err: number[] }, n: number,
  method: Calibration["method"]): Calibration {
  return { rotDeg: f.th / RAD, mirrored: f.mirrored, tx: f.tx, ty: f.ty, meanErr: mean(f.err),
    maxErr: Math.max(...f.err), matched: n, method };
}

/** SDK world (x, z) -> plan (x, y). */
export function sdkToPlan(c: Calibration, x: number, z: number): Vec2 {
  const ux = x, uy = -z;
  const a = c.rotDeg * RAD, cs = Math.cos(a), sn = Math.sin(a);
  const px = c.mirrored ? -ux : ux;
  return [cs * px - sn * uy + c.tx, sn * px + cs * uy + c.ty];
}

/** Plan (x, y) -> SDK world (x, z). */
export function planToSdk(c: Calibration, p: Vec2): { x: number; z: number } {
  const a = -c.rotDeg * RAD, cs = Math.cos(a), sn = Math.sin(a);
  const dx = p[0] - c.tx, dy = p[1] - c.ty;
  let ux = cs * dx - sn * dy;
  const uy = sn * dx + cs * dy;
  if (c.mirrored) ux = -ux;
  return { x: ux, z: -uy };
}

/** Plan compass heading (0 = +y, clockwise) -> SDK camera yaw (deg). Assumes yaw>0 turns left (three.js style);
 * YAW_SIGN is the one constant to flip if the live check says otherwise. */
export const YAW_SIGN = 1;
export function headingToYaw(c: Calibration, headingDeg: number): number {
  const h = headingDeg * RAD;
  const a = planToSdk(c, [Math.sin(h), Math.cos(h)]);
  const o = planToSdk(c, [0, 0]);
  const fx = a.x - o.x, fz = a.z - o.z;
  return YAW_SIGN * Math.atan2(-fx, -fz) / RAD;
}
/** Inverse of headingToYaw. */
export function yawToHeading(c: Calibration, yawDeg: number): number {
  const y = YAW_SIGN * yawDeg * RAD;
  const fx = -Math.sin(y), fz = -Math.cos(y);
  const o = sdkToPlan(c, 0, 0), p = sdkToPlan(c, fx, fz);
  return ((Math.atan2(p[0] - o[0], p[1] - o[1]) / RAD) % 360 + 360) % 360;
}
