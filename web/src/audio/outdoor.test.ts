import { describe, expect, it } from "vitest";
import { beaconRecipe, roadLine, trafficPoints } from "./outdoor";

describe("outdoor audio geometry", () => {
  it("three traffic panners on the road side, 8 m out, 20 m apart", () => {
    const pts = trafficPoints([[-30, -10], [30, -10]], [0, 0]);
    expect(pts).toHaveLength(3);
    expect(pts.every(p => p[1] === -18)).toBe(true); // away from the building at the origin
    expect(Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])).toBeCloseTo(20, 6);
  });
  it("the road line is square to the curb direction through the frontage point", () => {
    const [a, b] = roadLine([0, -10], [0, 0]);
    expect(a[1]).toBeCloseTo(-10, 6); expect(b[1]).toBeCloseTo(-10, 6); expect(Math.abs(a[0] - b[0])).toBeGreaterThan(70);
  });
  it("beacon: high tick on axis, low behind", () => {
    expect(beaconRecipe([0, 0], 0, [0, 5])).toBe("pulseOn");
    expect(beaconRecipe([0, 0], 90, [0, 5])).toBe("pulse");
    expect(beaconRecipe([0, 0], 180, [0, 5])).toBe("pulseBehind");
  });
});
