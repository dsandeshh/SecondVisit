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

/** The stage ?view=proj shows unless projstage=b|c|d says otherwise: the last stage that looked better than the one before. */
export const PROJ_STAGE: "b" | "c" | "d" = "c";

/** Debug knobs for ?view=proj (projstage picks a stage, see PROJ_STAGE): projrot=yaw drops the quaternion's small tilt (default: full quaternion, which matched
 *  the baked mesh best in a headless A/B over 9 camera poses: edge correlation 0.873 vs 0.798 yaw only, and yaw0 90
 *  beat 88 and 92), projdebug=1 tints projected texels green and baked fallback red. */
export function projOpts(search: string): { rot: RotMode; debug: boolean; stage: "b" | "c" | "d" } {
  const q = new URLSearchParams(search), st = q.get("projstage");
  return { rot: q.get("projrot") === "yaw" ? "yaw" : "quat", debug: q.get("projdebug") === "1", stage: st === "b" || st === "c" || st === "d" ? st : PROJ_STAGE };
}

// ---- which panos colour a surface point (stages c and d); projshader.ts mirrors this in GLSL ----

/** One candidate pano for one surface point. `visible`: the pano's depth cube says nothing is in between.
 *  `facing`: cos of the angle between the surface normal (turned toward the viewer) and the ray to the pano. */
/** `lumDiff`: |luma of the pano's blurred colour - luma of the baked texture's blurred colour| (sRGB-ish 0..1) at
 *  this point. The baked texture is right at low frequency, so a big difference means the photo shows something
 *  else (a scan edge a few cm off, a hole in the mesh): the photo-consistency check. */
export type ProjCand = { dist: number; visible: boolean; facing: number; lumDiff?: number };
/** Beyond FADE_M a pano fades out, by MAX_M it gives nothing; under FACING_LO (grazing, ~80 degrees) nothing,
 *  full trust from FACING_HI (~65 degrees); full trust up to AGREE_LO luma difference, none from AGREE_HI. */
export const PROJ = { FADE_M: 6, MAX_M: 9, FACING_LO: 0.15, FACING_HI: 0.4, AGREE_LO: 0.2, AGREE_HI: 0.45, CAP: 3, FALLOFF: 2 };
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Trust in one candidate, 0..1: line of sight, facing, range, photo consistency. */
export function projConf(c: ProjCand): number {
  if (!c.visible) return 0;
  return smooth(PROJ.FACING_LO, PROJ.FACING_HI, c.facing) * (1 - smooth(PROJ.FADE_M, PROJ.MAX_M, c.dist))
    * (1 - smooth(PROJ.AGREE_LO, PROJ.AGREE_HI, c.lumDiff ?? 0));
}

/**
 * Blend weights over candidates: w = conf / (dist^2 + 0.25)^FALLOFF (2: 1/d^4, so blending stays near the
 * places where two panos are about equally near and does not ghost everywhere), only the `cap` largest kept, normalised to sum 1.
 * `alpha` is how much of the photo to show over the baked texel (the best candidate's trust); 0 = baked only.
 * cap 1 is stage c (the single best visible pano), cap 3 is stage d.
 */
export function projBlend(cands: ProjCand[], cap = PROJ.CAP): { weights: number[]; alpha: number } {
  const raw = cands.map(c => projConf(c) / Math.pow(c.dist * c.dist + 0.25, PROJ.FALLOFF));
  const keep = raw.map((w, i) => [w, i] as const).filter(([w]) => w > 0).sort((a, b) => b[0] - a[0]).slice(0, cap);
  const weights = new Array(cands.length).fill(0);
  const sum = keep.reduce((s, [w]) => s + w, 0);
  if (sum <= 0) return { weights, alpha: 0 };
  keep.forEach(([w, i]) => { weights[i] = w / sum; });
  return { weights, alpha: Math.max(...keep.map(([, i]) => projConf(cands[i]))) };
}
