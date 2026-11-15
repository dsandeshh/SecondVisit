// Photo projection (?view=proj, experimental, default off): colour the scan mesh from the real panorama photos.
// Pure math here (tested in panoproj.test.ts); the GLSL in projshader.ts mirrors it line for line.
//
// Frames. Plan (CLAUDE.md rule 3): metres, x right, y up the plan, z up; bearing 0 = +y, clockwise.
// Pano frame "M": the pano's own camera frame, z up, face 1's centre along +x, faces 1..4 clockwise seen from
// above (+x, -y, -x, +y). M -> plan is L = Rq * Rz(90 - yaw0): Rq is the pano's rotation (its Model API quaternion,
// or just its yaw), and Rz(90 - yaw0) turns +x onto bearing yaw0 for a pano with no rotation, which is exactly
// engine/dr/annotate.py's calibration ("face 1's centre has bearing face_yaw0_deg - yaw_deg").
// GL cube frame: export_pano_faces.py stores face 1 = px, 2 = nz, 3 = nx, 4 = pz, unflipped, so the raw GL lookup
// vector of an M direction is (Mx, Mz, My) (see glFace for the GL face table).

export type Vec3 = [number, number, number];
/** Row-major 3x3. */
export type Mat3 = number[];
export type ProjPano = { id: string; pos: Vec3; quat: [number, number, number, number]; yaw_deg: number; dir: string; real_faces: string[] };
export type ProjIndex = { face_px: number; face_yaw0_deg: number; panos: ProjPano[] };
export type RotMode = "yaw" | "quat";

export const applyMat3 = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const mul = (a: Mat3, b: Mat3): Mat3 => {
  const o: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
};
const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
/** Rotation about +z by `deg`, counter clockwise seen from above. */
const rz = (deg: number): Mat3 => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

/** Rotation matrix of a unit quaternion (x, y, z, w). */
export function quatMat3([x, y, z, w]: [number, number, number, number]): Mat3 {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

/** Matrix taking a plan-frame direction (from the pano) to the raw GL lookup vector of that pano's cube map. */
export function panoToGL(p: ProjPano, yaw0Deg: number, mode: RotMode = "yaw"): Mat3 {
  const rq = mode === "quat" ? quatMat3(p.quat) : rz(p.yaw_deg);
  const L = mul(rq, rz(90 - yaw0Deg));          // M -> plan
  const P: Mat3 = [1, 0, 0, 0, 0, 1, 0, 1, 0];  // M (x, y, z) -> GL (x, z, y)
  return mul(P, transpose(L));                  // plan -> M -> GL
}

/** The OpenGL cube map face a raw lookup vector hits, and its s, t (t = 0 is the image's top row). */
export function glFace([rx, ry, rz_]: Vec3): { face: "px" | "nx" | "py" | "ny" | "pz" | "nz"; s: number; t: number } {
  const ax = Math.abs(rx), ay = Math.abs(ry), az = Math.abs(rz_);
  let face: "px" | "nx" | "py" | "ny" | "pz" | "nz", sc: number, tc: number, ma: number;
  if (ax >= ay && ax >= az) { ma = ax; if (rx > 0) { face = "px"; sc = -rz_; tc = -ry; } else { face = "nx"; sc = rz_; tc = -ry; } }
  else if (ay >= az) { ma = ay; if (ry > 0) { face = "py"; sc = rx; tc = rz_; } else { face = "ny"; sc = rx; tc = -rz_; } }
  else { ma = az; if (rz_ > 0) { face = "pz"; sc = rx; tc = -ry; } else { face = "nz"; sc = -rx; tc = -ry; } }
  return { face, s: (sc / ma + 1) / 2, t: (tc / ma + 1) / 2 };
}

/** The k panos nearest a plan point (horizontal distance), nearest first. */
export function nearestPanos(at: [number, number], panos: ProjPano[], k: number): ProjPano[] {
  return panos.map(p => [p, Math.hypot(p.pos[0] - at[0], p.pos[1] - at[1])] as const)
    .sort((a, b) => a[1] - b[1]).slice(0, k).map(([p]) => p);
}

/** `?view=proj` turns the experimental photo projection on; anything else leaves the baked texture alone. */
export const projWanted = (search: string): boolean => new URLSearchParams(search).get("view") === "proj";

/** Debug knobs for ?view=proj: projrot=yaw drops the quaternion's small tilt (default: full quaternion, which matched
 *  the baked mesh best in a headless A/B over 9 camera poses: edge correlation 0.873 vs 0.798 yaw only, and yaw0 90
 *  beat 88 and 92), projdebug=1 tints projected texels green and baked fallback red. */
export function projOpts(search: string): { rot: RotMode; debug: boolean } {
  const q = new URLSearchParams(search);
  return { rot: q.get("projrot") === "yaw" ? "yaw" : "quat", debug: q.get("projdebug") === "1" };
}
