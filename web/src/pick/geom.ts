// Pure helpers for pick.html (Task 3). Mirrors engine/dr/annotate.py face_bearing and calibrate_yaw0.
export type Vec2 = [number, number];
export interface FloorPlan { width: number; height: number; resolution: number; origin: Vec2 }

/** Plan metres to image pixels. The image's bottom left is `origin`; image y runs down. */
export function planToPx(fp: FloorPlan, p: Vec2): Vec2 {
  return [(p[0] - fp.origin[0]) * fp.resolution, fp.height - (p[1] - fp.origin[1]) * fp.resolution];
}

export function pxToPlan(fp: FloorPlan, px: Vec2): Vec2 {
  return [fp.origin[0] + px[0] / fp.resolution, fp.origin[1] + (fp.height - px[1]) / fp.resolution];
}

const wrap = (d: number) => ((d % 360) + 360) % 360;

/** Heading in degrees, 0 = +y, clockwise, from plan point a towards plan point b. */
export function headingFromDrag(a: Vec2, b: Vec2): number {
  return wrap((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI);
}

export function faceBearing(face: number, xPx: number, widthPx: number, yaw0: number, clockwise: boolean): number {
  const half = widthPx / 2;
  const off = (Math.atan((xPx - half) / half) * 180) / Math.PI;
  return wrap(yaw0 + (clockwise ? 90 : -90) * (face - 1) + off);
}

/** The face_yaw0_deg that makes faceBearing point from the pano at the target (the desk). */
export function calibrateYaw0(pano: Vec2, face: number, xPx: number, widthPx: number, target: Vec2,
                              clockwise: boolean): number {
  return wrap(headingFromDrag(pano, target) - faceBearing(face, xPx, widthPx, 0, clockwise));
}

export interface PickState {
  entrance: { pos: Vec2; heading_deg: number } | null;
  destination: { pos: Vec2; label: string } | null;
  extra: { kind: string; label: string; pos: Vec2 }[];
  deleted: string[];
  yaw0: number;
  clockwise: boolean;
  arrival: unknown;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const rp = (p: Vec2): Vec2 => [r2(p[0]), r2(p[1])];

/** overrides.json, ruling R5 schema. */
export function buildOverrides(s: PickState) {
  return {
    entrance: s.entrance
      ? { id: "ent_main", label: "Entrance", pos: rp(s.entrance.pos), heading_deg: r1(s.entrance.heading_deg) }
      : null,
    destination: s.destination ? { pos: rp(s.destination.pos), label: s.destination.label } : null,
    extra_landmarks: s.extra.map((l, i) => ({
      id: `hand_${i + 1}`, kind: l.kind, label: l.label, pos: rp(l.pos), confidence: 1, fixed: true,
    })),
    deleted_landmark_ids: s.deleted,
    face_yaw0_deg: r1(s.yaw0),
    faces_clockwise: s.clockwise,
    arrival: s.arrival ?? null,
  };
}
