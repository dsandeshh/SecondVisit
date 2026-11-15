// The one place plan coordinates become three.js coordinates (CLAUDE.md rule 3).
// Plan: metres, x right, y up (north), z up; heading 0 = +y, clockwise. Three: x right, y up, -z away.
import type { Vec2 } from "../types";

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type FloorPlanMeta = { origin: { x: number; y: number }; resolution: number; width: number; height: number };

export const toThree = (p: Vec2, z = 0): [number, number, number] => [p[0], z, -p[1]];

/** Unit direction of a heading in three coordinates. */
export function headingDir3(deg: number): [number, number, number] {
  const r = deg * Math.PI / 180;
  return [Math.sin(r), 0, -Math.cos(r)];
}

/** Rotation about three's +y that points an object's -z (forward) along the heading. */
export const headingToYaw = (deg: number): number => -deg * Math.PI / 180;

/** Greedy merge of cells whose code is in `codes` into rectangles (plan metres): runs along x, then stacked in y. */
export function wallRects(cells: Uint8Array, w: number, h: number, res: number, origin: Vec2, codes: number[]): Rect[] {
  const want = new Set(codes);
  const used = new Uint8Array(w * h);
  const out: Rect[] = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (used[i] || !want.has(cells[i])) continue;
      let c1 = c;
      while (c1 + 1 < w && !used[r * w + c1 + 1] && want.has(cells[r * w + c1 + 1])) c1++;
      let r1 = r;
      grow: while (r1 + 1 < h) {
        for (let k = c; k <= c1; k++) { const j = (r1 + 1) * w + k; if (used[j] || !want.has(cells[j])) break grow; }
        r1++;
      }
      for (let rr = r; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) used[rr * w + cc] = 1;
      out.push({ x0: origin[0] + c * res, y0: origin[1] + r * res, x1: origin[0] + (c1 + 1) * res, y1: origin[1] + (r1 + 1) * res });
    }
  }
  return out;
}

/** Centre and size in plan metres of the floor plan image (origin is its bottom left, resolution px per metre). */
export function floorPlanPlacement(f: FloorPlanMeta): { cx: number; cy: number; w: number; h: number } {
  const w = f.width / f.resolution, h = f.height / f.resolution;
  return { cx: f.origin.x + w / 2, cy: f.origin.y + h / 2, w, h };
}

/** 1 where the cell centre is inside the polygon (grid cell (r, c) centre per rule 3). */
export function roomMask(poly: Vec2[], w: number, h: number, res: number, origin: Vec2): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const x = origin[0] + (c + 0.5) * res, y = origin[1] + (r + 0.5) * res;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    m[r * w + c] = inside ? 1 : 0;
  }
  return m;
}

/** Matterport floor plans sit on a near black backdrop. Make those pixels transparent so the plan reads as light linework. */
export function clearBackdrop(data: Uint8ClampedArray, maxLum = 70): void {
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (lum < maxLum) data[i + 3] = 0;
  }
}
