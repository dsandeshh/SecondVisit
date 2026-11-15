// Plan frame (x east, y north, heading clockwise from +y) to Web Audio (right handed, forward = -z).
import type { Vec2 } from "../types";
import { wrap180 } from "../world";

export const toAudio = ([x, y]: Vec2): [number, number, number] => [x, 0, -y];

export const forwardFor = (h: number): [number, number, number] =>
  [Math.sin(h * Math.PI / 180), 0, -Math.cos(h * Math.PI / 180)];

/** Signed azimuth of src from the listener, degrees, positive = right. */
export function azimuth(listener: Vec2, heading: number, src: Vec2): number {
  const b = Math.atan2(src[0] - listener[0], src[1] - listener[1]) * 180 / Math.PI;
  return wrap180(b - heading);
}

/** Point the AudioListener; AudioParam form when present, else setOrientation (Firefox). */
export function placeListener(l: AudioListener, pos: Vec2, heading: number): void {
  const [x, y, z] = toAudio(pos), [fx, fy, fz] = forwardFor(heading);
  if (l.positionX) {
    l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
    l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else {
    (l as any).setPosition?.(x, y, z);
    (l as any).setOrientation?.(fx, fy, fz, 0, 1, 0);
  }
}
