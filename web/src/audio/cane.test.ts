import { describe, expect, it } from "vitest";
import { fixturePkg } from "../test/fakes";
import { World } from "../world";
import { autoSweep, sweepContact, TapGate } from "./cane";

const world = new World(fixturePkg());

describe("cane sweep", () => {
  it("sweep finds thin pillar", () => {
    expect(world.raycast([8.6, 6], 90 - 40, 1.2)).toBeNull();
    expect(world.raycast([8.6, 6], 90 + 40, 1.2)).toBeNull();
    const hit = sweepContact(world, [8.6, 6], 90, -40, 40);
    expect(hit).not.toBeNull();
    expect(hit!.code).toBe(2);
    expect(Math.abs(hit!.caneDeg)).toBeLessThanOrEqual(10);
    expect(hit!.at[0]).toBeGreaterThan(9.4);
  });
  it("sweep in open floor finds nothing", () => {
    expect(sweepContact(world, [5, 3], 90, -30, 30)).toBeNull();
  });
  it("autoSweep alternates the arc", () => {
    expect(autoSweep(0)).toEqual([-30, 30]);
    expect(autoSweep(1)).toEqual([30, -30]);
  });
});

describe("TapGate", () => {
  const wall = { dist: 0.5, code: 1 as const, caneDeg: 0, at: [1, 1] as [number, number] };
  it("tap gate is edge triggered", () => {
    const g = new TapGate();
    let taps = 0;
    for (let i = 0; i < 10; i++) if (g.update(wall, i * 16)) taps++;
    expect(taps).toBe(1);
    if (g.update({ ...wall, code: 4 }, 200)) taps++;
    expect(taps).toBe(2);
  });
  it("new surface more than 0.3 m away taps again", () => {
    const g = new TapGate();
    expect(g.update(wall, 0)).not.toBeNull();
    expect(g.update({ ...wall, at: [1.2, 1] }, 100)).toBeNull();
    expect(g.update({ ...wall, at: [1.5, 1] }, 200)).not.toBeNull();
  });
  it("tap gate rate limit", () => {
    const g = new TapGate();
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = i * 10;
      if (g.update(i % 2 === 0 ? wall : null, t)) times.push(t);
    }
    expect(times.length).toBeGreaterThan(1);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(60);
  });
});
