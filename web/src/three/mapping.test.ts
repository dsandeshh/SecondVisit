import { describe, expect, it } from "vitest";
import { dirOf } from "../world";
import { clearBackdrop, floorPlanPlacement, headingDir3, headingToYaw, roomMask, toThree, wallRects } from "./mapping";

describe("plan to three.js mapping (CLAUDE.md rule 3)", () => {
  it("plan x right, y up, z up becomes three x right, y up, -z forward", () => {
    expect(toThree([2, 3])).toEqual([2, 0, -3]);
    expect(toThree([2, 3], 1.5)).toEqual([2, 1.5, -3]);
  });
  it("heading 0 is +y (three -z), 90 is +x, clockwise", () => {
    const d0 = headingDir3(0), d90 = headingDir3(90), d180 = headingDir3(180);
    expect(d0[0]).toBeCloseTo(0); expect(d0[2]).toBeCloseTo(-1);
    expect(d90[0]).toBeCloseTo(1); expect(d90[2]).toBeCloseTo(0);
    expect(d180[2]).toBeCloseTo(1);
  });
  it("yaw rotates three's forward (-z) onto the heading direction", () => {
    for (const h of [0, 45, 90, 200, 315]) {
      const yaw = headingToYaw(h);
      // rotation about +y by yaw maps (0,0,-1) to (-sin yaw, 0, -cos yaw)
      const f: [number, number] = [-Math.sin(yaw), -Math.cos(yaw)];
      const d = headingDir3(h);
      expect(f[0]).toBeCloseTo(d[0]); expect(f[1]).toBeCloseTo(d[2]);
      const p = dirOf(h); expect(d[0]).toBeCloseTo(p[0]); expect(d[2]).toBeCloseTo(-p[1]);
    }
  });
  it("wall cells merge into rectangles placed where the grid says", () => {
    // 4 wide x 3 tall, res 0.5, origin (10, 20); row 0 is the lowest y
    const w = 4, h = 3;
    const cells = new Uint8Array(w * h);
    cells[0] = cells[1] = cells[2] = cells[3] = 1;   // bottom row, a 4 cell run
    cells[1 * w + 0] = 1; cells[2 * w + 0] = 1;      // left column rows 1 and 2
    const rects = wallRects(cells, w, h, 0.5, [10, 20], [1]);
    const area = rects.reduce((a, r) => a + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    expect(area).toBeCloseTo(6 * 0.25);
    expect(rects.length).toBeLessThanOrEqual(2);
    const bottom = rects.find(r => r.y0 === 20)!;
    expect(bottom.x0).toBe(10); expect(bottom.x1).toBe(12); expect(bottom.y1).toBe(20.5);
    const minY = Math.min(...rects.map(r => r.y0)), maxY = Math.max(...rects.map(r => r.y1));
    expect(minY).toBe(20); expect(maxY).toBe(21.5);
  });
  it("only requested codes are used", () => {
    const cells = new Uint8Array([1, 3, 4, 0]);
    expect(wallRects(cells, 4, 1, 1, [0, 0], [3]).length).toBe(1);
    expect(wallRects(cells, 4, 1, 1, [0, 0], [3])[0].x0).toBe(1);
    expect(wallRects(cells, 4, 1, 1, [0, 0], [2]).length).toBe(0);
  });
  it("floor plan image is placed from origin (bottom left, metres) and px per metre", () => {
    const p = floorPlanPlacement({ origin: { x: -30.817, y: -12.9795 }, resolution: 100, width: 4366, height: 1532 });
    expect(p.w).toBeCloseTo(43.66); expect(p.h).toBeCloseTo(15.32);
    expect(p.cx).toBeCloseTo(-30.817 + 21.83); expect(p.cy).toBeCloseTo(-12.9795 + 7.66);
  });
  it("roomMask marks cells inside a polygon", () => {
    const poly: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const m = roomMask(poly, 4, 2, 0.5, [0, 0]);
    expect([...m]).toEqual([1, 1, 0, 0, 1, 1, 0, 0]);
  });
  it("clears the near black backdrop of a floor plan and keeps light pixels", () => {
    const px = new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 255]);
    clearBackdrop(px);
    expect([px[3], px[7]]).toEqual([0, 255]);
  });
});
