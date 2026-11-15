// Camera moves for the outdoor scene (agent6 4.1.3 item 9). Pure maths in three coordinates (plan x, up, -plan y).
import { headingDir3, toThree } from "../mapping";
import type { Vec2 } from "../../types";

export type Pose = { pos: [number, number, number]; look: [number, number, number]; up: [number, number, number] };

export const OVERHEAD_M = 45;
export const FOLLOW_M = 12;
export const OBLIQUE_DEG = 35;
export const FLY_S = 4;
export const DOOR_S = 2;

export const easeInOut = (t: number): number => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Straight down over the drop off: reads as the aerial photo (north up). */
export function overheadPose(curb: Vec2, alt = OVERHEAD_M): Pose {
  const [x, , z] = toThree(curb);
  return { pos: [x, alt, z], look: [x, 0, z], up: [0, 0, -1] };
}

/** 35 degree oblique behind the walker, `dist` m away, looking slightly ahead of them. */
export function followPose(pos: Vec2, heading: number, dist = FOLLOW_M, deg = OBLIQUE_DEG): Pose {
  const [x, , z] = toThree(pos), [fx, , fz] = headingDir3(heading), r = deg * Math.PI / 180;
  const back = dist * Math.cos(r);
  return { pos: [x - fx * back, dist * Math.sin(r) + 1, z - fz * back], look: [x + fx * 3, 0.8, z + fz * 3], up: [0, 1, 0] };
}

/** Through the doorway: eye height, 2.5 m past the door along the way in, looking further in. */
export function doorPose(door: Vec2, heading: number): Pose {
  const [x, , z] = toThree(door), [fx, , fz] = headingDir3(heading);
  return { pos: [x + fx * 2.5, 1.6, z + fz * 2.5], look: [x + fx * 6, 1.4, z + fz * 6], up: [0, 1, 0] };
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const k = easeInOut(t);
  const up = mix3(a.up, b.up, k), L = Math.hypot(...up) || 1;
  return { pos: mix3(a.pos, b.pos, k), look: mix3(a.look, b.look, k), up: [up[0] / L, up[1] / L, up[2] / L] };
}

/** When each thing is revealed during the 4 s fly in (seconds): ground first, then pin, path, door and canopy, building. */
export const REVEAL_AT = { ground: 0, curb: 0.5, path: 1.2, door: 2.0, building: 2.7 } as const;
export type RevealKey = keyof typeof REVEAL_AT;
