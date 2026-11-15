import { describe, expect, it } from "vitest";
import { gridPkg } from "../test/fakes";
import type { Vec2 } from "../types";
import { World } from "../world";
import { azimuth } from "./space";
import { beaconAz, beaconRate, beaconSpot, nearestAhead, proxGain, proxRate } from "./continuous";

describe("continuous beacon", () => {
  it("pulses about 1/s beyond 10 m, 4/s within 2 m, interpolated in between", () => {
    expect(beaconRate(25)).toBe(1); expect(beaconRate(10)).toBe(1);
    expect(beaconRate(2)).toBe(4); expect(beaconRate(0.5)).toBe(4);
    expect(beaconRate(6)).toBeCloseTo(2.5);
    expect(beaconRate(8)).toBeLessThan(beaconRate(4));
  });
  it("the panner angle equals the target's true bearing from the walker's pose", () => {
    const cases: [Vec2, number, Vec2][] = [[[0, 0], 0, [0, 10]], [[0, 0], 0, [10, 0]], [[3, 4], 90, [3, 9]], [[1, 1], 200, [-5, -2]], [[2, 2], 315, [8, 9]]];
    for (const [pos, heading, target] of cases) {
      const spot = beaconSpot(pos, target);
      const truth = Math.atan2(target[0] - pos[0], target[1] - pos[1]) * 180 / Math.PI - heading;
      const wrap = (a: number) => ((a + 540) % 360) - 180;
      expect(azimuth(pos, heading, spot)).toBeCloseTo(wrap(truth), 6);
      expect(beaconAz(pos, heading, target)).toBeCloseTo(wrap(truth), 6);
      expect(Math.hypot(spot[0] - pos[0], spot[1] - pos[1])).toBeCloseTo(2, 6);   // a steady level at any range
    }
    expect(beaconAz([0, 0], 0, [10, 0])).toBeCloseTo(90);     // east of a walker facing north: 3 o'clock, right
    expect(beaconAz([0, 0], 90, [0, 10])).toBeCloseTo(-90);   // facing east, the target north is on the left
  });
});

describe("continuous obstacle proximity", () => {
  it("is silent beyond 3 m and with nothing ahead", () => {
    for (const d of [3.01, 4, 12, Infinity, NaN, null, undefined]) { expect(proxRate(d as number)).toBe(0); expect(proxGain(d as number)).toBe(0); }
    expect(proxRate(3)).toBeGreaterThan(0);
    expect(proxRate(0.5)).toBeGreaterThan(proxRate(2.5));      // faster as it gets nearer
    expect(proxGain(1)).toBeGreaterThan(0);
  });
  it("finds the nearest solid thing in the 60 degree cone, with its direction", () => {
    // a 10 x 10 room, walls round it; the walker 2 m from the north wall facing north
    const rows = ["##########", ...Array(8).fill("#........#"), "##########"];
    const w = new World(gridPkg(rows));
    const n = nearestAhead(w, [5, 7.5], 0)!;
    expect(n.code).toBe(1);
    expect(n.dist).toBeGreaterThan(1.3); expect(n.dist).toBeLessThan(1.6);
    expect(Math.abs(n.az)).toBeLessThanOrEqual(30);
    expect(nearestAhead(w, [5, 2.5], 0)).toBeNull();            // 6.5 m of floor ahead: nothing within 3 m
    expect(proxRate(nearestAhead(w, [5, 2.5], 0)?.dist)).toBe(0);
  });
});
