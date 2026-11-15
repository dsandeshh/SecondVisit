import { describe, expect, it } from "vitest";
import { azimuth, forwardFor, toAudio } from "./space";

describe("space mapping", () => {
  it("azimuth east is right", () => {
    expect(Math.abs(azimuth([0, 0], 0, [3, 0]) - 90)).toBeLessThanOrEqual(1);
    expect(Math.abs(azimuth([0, 0], 90, [0, -3]) - 90)).toBeLessThanOrEqual(1);
    expect(Math.abs(azimuth([0, 0], 0, [-3, 0]) + 90)).toBeLessThanOrEqual(1);
    expect(toAudio([3, 0])[0]).toBeGreaterThan(0);
    const f = forwardFor(0);
    expect(f[0]).toBeCloseTo(0, 9);
    expect(f[1]).toBeCloseTo(0, 9);
    expect(f[2]).toBeCloseTo(-1, 9);
  });
  it("north in plan is forward (-z) in audio", () => {
    expect(toAudio([0, 4])[2]).toBe(-4);
    const e = forwardFor(90);
    expect(e[0]).toBeCloseTo(1, 9);
  });
});
