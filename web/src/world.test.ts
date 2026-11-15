import { describe, expect, it } from "vitest";
import { STEP_M } from "./config";
import { fixturePkg } from "./test/fakes";
import { Traveller, World } from "./world";

const world = new World(fixturePkg());

describe("World", () => {
  it("raycast hits west wall", () => {
    // Ruling R2: (2, 6) escapes through the west gap, so cast from (2, 3).
    const hit = world.raycast([2, 3], 270, 5);
    expect(hit).not.toBeNull();
    expect(hit!.code).toBe(1);
    expect(Math.abs(hit!.dist - 1.8)).toBeLessThanOrEqual(0.1);
  });
  it("cellAt reads the pillar and free floor", () => {
    expect(world.cellAt([10, 6])).toBe(2);
    expect(world.cellAt([5, 3])).toBe(0);
    expect(world.cellAt([-3, 3])).toBe(1); // off grid counts as solid
  });
  it("roomAt is null without rooms", () => expect(world.roomAt([5, 5])).toBeNull());
});

describe("Traveller", () => {
  it("step moves STEP_M", () => {
    const t = new Traveller(world, [5, 3], 90);
    expect(t.step(1)).toBe("ok");
    expect(t.pos[0]).toBeCloseTo(5 + STEP_M, 6);
    expect(t.pos[1]).toBeCloseTo(3, 6);
    expect(t.step(-1)).toBe("ok");
    expect(t.pos[0]).toBeCloseTo(5, 6);
  });
  it("bump into wall keeps position and returns bump", () => {
    const t = new Traveller(world, [0.6, 3], 270);
    expect(t.step(1)).toBe("bump");
    expect(t.pos).toEqual([0.6, 3]);
  });
  it("clamped position never NaN after 200 random steps", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const t = new Traveller(world, [2, 6], 270);
    for (let i = 0; i < 200; i++) {
      t.turn(Math.floor(rnd() * 24) * 15);
      t.step(rnd() < 0.8 ? 1 : -1);
      expect(Number.isFinite(t.pos[0]) && Number.isFinite(t.pos[1])).toBe(true);
      expect(world.inBounds(t.pos)).toBe(true);
      expect(t.heading).toBeGreaterThanOrEqual(0);
      expect(t.heading).toBeLessThan(360);
    }
  });
  it("turn wraps and cane is clamped", () => {
    const t = new Traveller(world, [5, 3], 350);
    t.turn(15);
    expect(t.heading).toBe(5);
    t.setCane(80);
    expect(t.caneDeg).toBe(50);
    t.setCane(NaN);
    expect(t.caneDeg).toBe(0);
  });
});
