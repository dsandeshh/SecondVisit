import { describe, expect, it } from "vitest";
import type { Vec2 } from "../../types";
import { inDoorOpening, pointInPolygon, segmentsCross, stepOutdoor, worldOf } from "./step";

const box: Vec2[] = [[-10, -5], [5, -5], [5, 2], [-10, 2]];
// building to the west; the door at (3, 0) opens east (walking in = heading 270)
const w = worldOf({ building_outline_plan: box, canopy_plan: [[4, -2], [8, -2], [8, 2], [4, 2]] }, [3, 0], 270);
const withEdge = { ...w, edge: [[9, -3], [9, 3]] as [Vec2, Vec2] };

describe("outdoor step", () => {
  it("polygon and segment tests", () => {
    expect(pointInPolygon([0, 0], box)).toBe(true);
    expect(pointInPolygon([6, 0], box)).toBe(false);
    expect(segmentsCross([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
    expect(segmentsCross([0, 0], [1, 0], [0, 1], [1, 1])).toBe(false);
  });
  it("the building is a wall, away from the door", () => {
    const r = stepOutdoor(w, [5.2, 1.5], 270); // heading west into the wall at y 1.5, off the door line
    expect(r.blocked).toBe(true);
    expect(r.pos).toEqual([5.2, 1.5]);
  });
  it("the opening in front of the door lets the walker in", () => {
    expect(inDoorOpening(w, [5.4, 0])).toBe(true);
    const r = stepOutdoor(w, [5.4, 0], 270);
    expect(r.blocked).toBe(false);
    expect(r.pos[0]).toBeCloseTo(4.7, 6);
  });
  it("reaches the door", () => {
    let p: Vec2 = [10, 0];
    let at = false;
    for (let i = 0; i < 12 && !at; i++) { const r = stepOutdoor(w, p, 270); p = r.pos; at = r.atDoor; }
    expect(at).toBe(true);
    expect(p[0]).toBeLessThan(4.1);
  });
  it("raises canopy entry once and the edge line once", () => {
    let p: Vec2 = [10, 0], enters = 0, edges = 0;
    for (let i = 0; i < 6; i++) { const r = stepOutdoor(withEdge, p, 270); p = r.pos; enters += +r.enteredCanopy; edges += +r.crossedEdge; }
    expect(enters).toBe(1);
    expect(edges).toBe(1);
  });
  it("a world without an outline never blocks", () => {
    expect(stepOutdoor({ ...w, outline: null }, [0, 0], 90).blocked).toBe(false);
  });
});
