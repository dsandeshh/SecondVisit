import { describe, expect, it } from "vitest";
import { doorPose, easeInOut, followPose, lerpPose, overheadPose, REVEAL_AT } from "./camera";

describe("outdoor camera", () => {
  it("starts 45 m above the drop off looking down", () => {
    const p = overheadPose([10, -2]);
    expect(p.pos[1]).toBe(45); expect(p.pos[0]).toBe(10); expect(p.look[1]).toBe(0);
  });
  it("follows 12 m behind, at 35 degrees", () => {
    const p = followPose([0, 0], 0); // walking north = three -z, so the camera is at +z
    expect(p.pos[2]).toBeGreaterThan(9); expect(Math.hypot(p.pos[2], p.pos[1] - 1)).toBeCloseTo(12, 3);
    expect(p.pos[1]).toBeCloseTo(1 + 12 * Math.sin(35 * Math.PI / 180), 3);
  });
  it("eases and ends exactly on the target pose", () => {
    const a = overheadPose([0, 0]), b = followPose([0, 0], 90);
    lerpPose(a, b, 0).pos.forEach((v, i) => expect(v).toBeCloseTo(a.pos[i], 9));
    lerpPose(a, b, 1).pos.forEach((v, i) => expect(v).toBeCloseTo(b.pos[i], 9));
    expect(easeInOut(0.5)).toBe(0.5);
    expect(Math.hypot(...lerpPose(a, b, 0.4).up)).toBeCloseTo(1, 6);
  });
  it("moves through the door along the way in", () => {
    const p = doorPose([0, 0], 270); // west = three -x
    expect(p.pos[0]).toBeCloseTo(-2.5, 6);
  });
  it("reveals in order", () => {
    const t = Object.values(REVEAL_AT);
    expect([...t].sort((x, y) => x - y)).toEqual(t);
  });
});
