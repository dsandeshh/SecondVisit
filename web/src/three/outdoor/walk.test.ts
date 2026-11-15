// A greedy walker (no map, only "where is the door from here", as the B beacon tells a listener) must reach the
// door from the curb in under 15 presses (turns + steps), starting at the controller's own start heading.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuildingPackage, Vec2 } from "../../types";
import { wrap180 } from "../../world";
import { startHeading } from "./start";
import { stepOutdoor, worldOf } from "./step";

const TURN = 15;

function greedy(pkg: BuildingPackage, max = 60) {
  const a = pkg.arrival!; const door = (a.door_plan ?? pkg.entrances[0].pos) as Vec2;
  const w = worldOf(a as any, door, pkg.entrances[0]?.heading_deg ?? 270);
  let pos = (a.curb_plan ?? a.dropoff_plan) as Vec2, h = startHeading(pkg), turns = 0, steps = 0, bumps = 0;
  for (let i = 0; i < max; i++) {
    const d = wrap180(Math.atan2(door[0] - pos[0], door[1] - pos[1]) * 180 / Math.PI - h);
    if (Math.abs(d) > TURN / 2) { h = (h + Math.sign(d) * TURN + 360) % 360; turns++; continue; }
    const r = stepOutdoor(w, pos, h); steps++; if (r.blocked) bumps++; pos = r.pos;
    if (r.atDoor) return { reached: true, turns, steps, bumps, presses: turns + steps };
  }
  return { reached: false, turns, steps, bumps, presses: turns + steps };
}

const box: Vec2[] = [[-10, -5], [3, -5], [3, 5], [-10, 5]];
const synthetic = {
  entrances: [{ id: "e", label: "Main entrance", pos: [3, 0], heading_deg: 270 }],
  arrival: { curb_plan: [10, -2], door_plan: [3, 0], building_outline_plan: box, canopy_plan: null, cues: [], lines: [] },
} as unknown as BuildingPackage;

describe("curb walk: start heading and a greedy walker", () => {
  it("starts facing the building: the entrance heading, which is the arrival script's reference", () => {
    expect(startHeading(synthetic)).toBe(270);
  });
  it("synthetic: reaches the door in under 15 presses, no bumps", () => {
    const r = greedy(synthetic);
    expect(r.reached).toBe(true); expect(r.bumps).toBe(0); expect(r.presses).toBeLessThan(15);
  });
  const path = "public/buildings/x37LjPx62VA/package.json";
  it.skipIf(!existsSync(path))("clinic: reaches the door in under 15 presses, no bumps", () => {
    const pkg = JSON.parse(readFileSync(path, "utf8")) as BuildingPackage;
    const r = greedy(pkg);
    expect(r.reached).toBe(true); expect(r.bumps).toBe(0); expect(r.presses).toBeLessThan(15);
    expect(r.turns).toBeLessThanOrEqual(3);
  });
});
