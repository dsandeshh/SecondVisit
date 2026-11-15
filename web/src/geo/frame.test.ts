import { describe, expect, it } from "vitest";
import cases from "../../../data/fixtures/clock_cases.json";
import type { BuildingPackage, GeoAnchor, Vec2 } from "../types";
import { existsSync, readFileSync } from "node:fs";
import { bearingDeg, clockOf, enToPlan, geoToPlan, haversineM, planBearing, planToGeo, wktLonLat } from "./frame";
import { pointInPolygon } from "../three/outdoor/step";

const A: GeoAnchor = { lat: 29.9665098, lon: -95.5395056, plan_pos: [2.9, 0.1], plan_north_deg: 243.1 };

describe("geo frame", () => {
  it("round trips under 1 cm within 100 m, both handedness", () => {
    let k = 1;
    const rnd = () => ((k = (k * 16807) % 2147483647) / 2147483647) * 200 - 100;
    for (const mirror of [false, true]) {
      const a = { ...A, mirror };
      for (let i = 0; i < 50; i++) {
        const x = a.plan_pos[0] + rnd(), y = a.plan_pos[1] + rnd();
        const g = planToGeo(a, x, y), [x2, y2] = geoToPlan(a, g.lat, g.lon);
        expect(Math.hypot(x - x2, y - y2)).toBeLessThan(0.01);
      }
    }
  });
  it("the anchor maps to plan_pos and north/east go where agent6 says", () => {
    expect(geoToPlan(A, A.lat, A.lon)).toEqual([2.9, 0.1]);
    const n = { lat: 30, lon: -95, plan_pos: [0, 0] as Vec2, plan_north_deg: 90 };
    const [nx, ny] = enToPlan(n, 0, 10), [ex, ey] = enToPlan(n, 10, 0);
    expect([nx, ny, ex, ey].map(v => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, 10, 10, 0]);
    expect(clockOf(80, 63.1)).toBe(1); expect(clockOf(0, 90)).toBe(9);
    expect(bearingDeg(1, 0)).toBe(90);
  });
  it("clock hours match the shared cases", () => {
    for (const c of cases.cases) expect(clockOf(c.rel_deg, 0)).toBe(c.hour);
  });
  it("reads WKT lon/lat corners", () => {
    expect(wktLonLat("POLYGON((-95.5 29.9,-95.4 29.9,-95.4 30.0,-95.5 30.0,-95.5 29.9))")).toHaveLength(4);
  });
  const path = "public/buildings/x37LjPx62VA/package.json";
  it.skipIf(!existsSync(path))("clinic: door is the entrance, curb is outside, distance is the haversine", () => {
    const p = JSON.parse(readFileSync(path, "utf8")) as BuildingPackage;
    const a = p.frames.geo_anchor!, ar = p.arrival!;
    const door = geoToPlan(a, a.lat, a.lon);
    expect(Math.hypot(door[0] - p.entrances[0].pos[0], door[1] - p.entrances[0].pos[1])).toBeLessThan(0.01);
    const curb = geoToPlan(a, ar.dropoff[0], ar.dropoff[1]);
    expect(pointInPolygon(curb, ar.building_outline_plan!)).toBe(false);
    expect(Math.hypot(curb[0] - ar.curb_plan![0], curb[1] - ar.curb_plan![1])).toBeLessThan(0.05);
    const hv = haversineM(a.lat, a.lon, ar.dropoff[0], ar.dropoff[1]);
    expect(Math.abs(Math.hypot(curb[0] - door[0], curb[1] - door[1]) - hv)).toBeLessThan(0.05);
    expect(planBearing(a, 1, 0)).toBeGreaterThanOrEqual(0);
  });
});
