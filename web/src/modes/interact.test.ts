// Tests from review/agent5_interaction.md 4.12, written first. Each is short and checks one rule.
import { describe, expect, it } from "vitest";
import { gridPkg } from "../test/fakes";
import type { Door, Room, Vec2 } from "../types";
import { World } from "../world";
import { beaconPoint, findPath, nextPick, pulseInterval, pulseKind, targetOrder } from "./beacon";
import { BumpGate, bumpOf } from "./bump";
import { ApproachTracker, crossesDoor, RoomTracker, roomLine, roomSize } from "./rooms";
import { aheadItems, aheadLine, sweepItems, type Item } from "./sweep";
import { isPossibly, possiblyOpts } from "../names";

const item = (id: string, x: number, y: number, kind = "desk"): Item => ({ id, kind, at: [x, y], name: id, possibly: false, fixed: true });
const open = new World(gridPkg(Array(30).fill(".".repeat(30))));
const at = (r: number, deg: number): Vec2 => [15 + r * Math.sin(deg * Math.PI / 180), 15 + r * Math.cos(deg * Math.PI / 180)];

describe("sweep (Q)", () => {
  it("sweep clockwise from ahead: bearings 270, 10, 90 give order 10, 90, 270", () => {
    const items = [item("w", ...at(4, 270)), item("n", ...at(4, 10)), item("e", ...at(4, 90))];
    expect(sweepItems(items, [15, 15], 0, open).map(i => i.id)).toEqual(["n", "e", "w"]);
  });
  it("sweep clockwise is measured from the heading, not north", () => {
    const items = [item("w", ...at(4, 270)), item("n", ...at(4, 10)), item("e", ...at(4, 90))];
    expect(sweepItems(items, [15, 15], 90, open).map(i => i.id)).toEqual(["e", "w", "n"]);
  });
  it("sweep keeps the 6 nearest of 9, then clockwise", () => {
    const kinds = ["desk", "door", "sign", "pillar", "water", "other", "stairs", "elevator", "restroom"];
    const items = Array.from({ length: 9 }, (_, i) => item(`i${i}`, ...at(1 + i * 0.7, i * 40 + 5), kinds[i]));
    const out = sweepItems(items, [15, 15], 0, open);
    expect(out).toHaveLength(6);
    expect(new Set(out.map(i => i.id))).toEqual(new Set(["i0", "i1", "i2", "i3", "i4", "i5"]));
    const az = out.map(i => (i.az + 360) % 360);
    expect(az).toEqual([...az].sort((a, b) => a - b));
  });
  it("sweep skips items behind walls in another room and beyond 8 m", () => {
    const rows = ["##########", "#...#....#", "#...#....#", "#...#....#", "##########"];
    const rooms: Room[] = [
      { id: "a", label: "A", polygon: [[1, 1], [4, 1], [4, 4], [1, 4]], area_m2: 9 },
      { id: "b", label: "B", polygon: [[5, 1], [9, 1], [9, 4], [5, 4]], area_m2: 12 }];
    const w = new World(gridPkg(rows, { rooms }));
    const out = sweepItems([item("near", 2.5, 2.5), item("behind", 7, 2.5)], [1.5, 2.5], 90, w);
    expect(out.map(i => i.id)).toEqual(["near"]);
    expect(sweepItems([item("far", 25, 15)], [15, 15], 0, open)).toHaveLength(0);
  });
  it("same kind within 1.5 m is grouped and said as the plural", () => {
    const items = [item("c1", ...at(4, 0), "seating"), item("c2", 15, 19.5, "seating"), item("d", ...at(4, 90), "door")];
    const out = sweepItems(items, [15, 15], 0, open);
    const chairs = out.find(i => i.kind === "seating")!;
    expect(chairs.name).toBe("chairs"); expect(chairs.count).toBe(2);
    expect(out.find(i => i.kind === "door")!.name).toBe("d");
  });
});

describe("ahead (E)", () => {
  it("ahead cone is plus or minus 30: azimuth 29 in, 31 out", () => {
    const out = aheadItems([item("in", ...at(5, 29)), item("out", ...at(5, 31))], [15, 15], 0, open);
    expect(out.map(i => i.id)).toEqual(["in"]);
  });
  it("ahead says the wall in steps, or the open run", () => {
    const w = new World(gridPkg(["#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#####"]));
    expect(aheadLine(w, [2.5, 1.5], 0, undefined).text).toMatch(/^Wall ahead in \d+ steps\.$/);
    expect(aheadLine(open, [15, 15], 0).text).toMatch(/^Open for at least 17 steps\.$/);
  });
});

describe("beacon", () => {
  it("pulse interval: 0 m 0.25, 5 m 1.0, 20 m capped at 1.2", () => {
    expect(pulseInterval(0)).toBeCloseTo(0.25); expect(pulseInterval(5)).toBeCloseTo(1.0); expect(pulseInterval(20)).toBe(1.2);
  });
  it("pulse kind bands: 10 on axis, 60 normal, 150 behind (either side)", () => {
    expect(pulseKind(10)).toBe("pulseOn"); expect(pulseKind(-10)).toBe("pulseOn");
    expect(pulseKind(60)).toBe("pulse"); expect(pulseKind(150)).toBe("pulseBehind"); expect(pulseKind(-150)).toBe("pulseBehind");
  });
  const L = new World(gridPkg(["########", "#.....##", "#.#####", "#.#####", "#.#####", "########"]));
  it("beacon aims at the visible waypoint: an L corridor gives the corner, not the target", () => {
    const corner: Vec2 = [1.5, 4.5], target: Vec2 = [5.5, 4.5];  // corridor along y at x 1.5, then along x at y 4.5
    expect(beaconPoint([corner, target], [1.5, 1.5], target, L)).toEqual(corner);
    expect(beaconPoint([corner, target], [4.5, 4.5], target, L)).toEqual(target);
  });
  it("find path turns the corner of an L corridor", () => {
    const p = findPath(L, [1.5, 1.5], [5.5, 4.5])!;
    expect(p.length).toBeGreaterThanOrEqual(2);
    expect(p[p.length - 1]).toEqual([5.5, 4.5]);
    expect(p[0][0]).toBeCloseTo(1.5, 0);
  });
  it("tab order: destination, doors, desk, restroom, elevator, then nearest; wraps both ways", () => {
    const items = [item("lift", 1, 0, "elevator"), item("desk", 5, 0, "desk"), item("dest", 9, 0, "desk"), item("door", 6, 0, "door"), item("wc", 2, 0, "restroom"), item("chair", 0.5, 0, "seating")];
    const order = targetOrder(items, [0, 0], "dest").map(i => i.id);
    expect(order).toEqual(["dest", "door", "desk", "wc", "lift", "chair"]);
    const o = targetOrder(items, [0, 0], "dest");
    expect(nextPick(o, null, 1)!.id).toBe("dest");
    expect(nextPick(o, "chair", 1)!.id).toBe("dest");
    expect(nextPick(o, "dest", -1)!.id).toBe("chair");
  });
});

describe("bump", () => {
  it("bump names glass: stepping into a code 4 cell gives glass", () => {
    const w = new World(gridPkg(["#####", "#.g.#", "#####"]));
    expect(bumpOf(w, [1.5, 1.5], 90, [])!.label).toBe("glass");
  });
  it("walls say wall; an unlabelled obstacle says obstacle (never a guess); a labelled one its name, may move if not fixed", () => {
    const w = new World(gridPkg(["######", "#..o.#", "######"]));
    expect(bumpOf(w, [1.5, 1.5], 0, [])!.label).toBe("wall");
    expect(bumpOf(w, [2.5, 1.5], 90, [])!.label).toBe("obstacle");
    const b = bumpOf(w, [2.5, 1.5], 90, [{ ...item("check-in counter", 3.5, 1.5), fixed: false }])!;
    expect(b.label).toBe("check-in counter"); expect(b.may_move).toBe(true);
  });
  it("within 0.5 m of a door segment the word is door", () => {
    const w = new World(gridPkg(["######", "#....#", "######"]));
    const door: Door = { id: "d", a: [5, 0.5], b: [5, 2.5], rooms: [] };
    expect(bumpOf(w, [4.4, 1.5], 90, [], [door])!.label).toBe("door");
  });
  it("bump name is not repeated within 2 s (same blocker), but is after", () => {
    const g = new BumpGate();
    expect(g.shouldName("1@3,3", 0)).toBe(true);
    expect(g.shouldName("1@3,3", 1500)).toBe(false);
    expect(g.shouldName("4@1,1", 1600)).toBe(true);      // another blocker
    expect(g.shouldName("1@3,3", 2500)).toBe(true);
  });
});

describe("where am I and rooms", () => {
  it("room size: an 8 by 6 rectangle rotated 30 degrees reads about 8 by 6 metres", () => {
    const a = 30 * Math.PI / 180, rot = ([x, y]: Vec2): Vec2 => [x * Math.cos(a) - y * Math.sin(a) + 20, x * Math.sin(a) + y * Math.cos(a) + 5];
    const poly = ([[0, 0], [8, 0], [8, 6], [0, 6]] as Vec2[]).map(rot);
    const [l, w] = roomSize(poly);
    expect(l).toBeCloseTo(8, 5); expect(w).toBeCloseTo(6, 5);
    expect(roomLine({ id: "r", label: "Waiting room", polygon: poly, area_m2: 48 })).toBe("Waiting room, about 8 by 6 metres.");
  });
  const door: Door = { id: "d", a: [5, 0], b: [5, 2], rooms: [] };
  it("door crossing fires once: walking through gives one crossing and one room line", () => {
    const rooms = [{ id: "a", label: "A" }, { id: "b", label: "B" }] as Room[];
    const roomAt = (x: number) => (x < 5 ? rooms[0] : rooms[1]);
    const tr = new RoomTracker(); tr.step(rooms[0], false);
    let crossings = 0, lines = 0, prev: Vec2 = [3.5, 1];
    for (let x = 4.2; x <= 8; x += 0.7) {
      const cur: Vec2 = [x, 1], crossed = crossesDoor(prev, cur, door);
      if (crossed) crossings++;
      if (tr.step(roomAt(x), crossed)) lines++;
      prev = cur;
    }
    expect(crossings).toBe(1); expect(lines).toBe(1);
  });
  it("a move that misses the jambs is not a crossing; parallel moves are not either", () => {
    expect(crossesDoor([3, 5], [7, 5], door)).toBe(false);
    expect(crossesDoor([3, 1], [3, 1.7], door)).toBe(false);
  });
  it("open plan: a new room without a door must hold for two steps", () => {
    const tr = new RoomTracker(); const a = { id: "a" } as Room, b = { id: "b" } as Room;
    tr.step(a, false);
    expect(tr.step(b, false)).toBeNull(); expect(tr.step(a, false)).toBeNull();  // flicker back: nothing
    expect(tr.step(b, false)).toBeNull(); expect(tr.step(b, false)).toBe(b);
  });
});

describe("callouts and doorways", () => {
  it("callout once per approach: approach, leave beyond 4 m, approach again gives two; standing still gives one", () => {
    const t = new ApproachTracker(2.5, 4, 0);
    const fires = (ds: number[]) => ds.reduce((n, d, i) => n + (t.check("desk", d, i * 5000) ? 1 : 0), 0);
    expect(fires([6, 3, 2, 1.5, 1.5, 1.5])).toBe(1);
    expect(fires([3, 4.5, 3, 2])).toBe(1);            // left beyond 4 m, came back: a second callout
    expect(new ApproachTracker(2.5, 4, 4000).check("x", 1, 0)).toBe(true);
  });
  it("one callout per 4 s overall", () => {
    const t = new ApproachTracker(2.5, 4, 4000);
    expect(t.check("a", 1, 0)).toBe(true);
    expect(t.check("b", 1, 1000)).toBe(false);
    expect(t.check("b", 1, 4100)).toBe(true);
  });
  it("low confidence says possibly: a separate prefix, never part of the name", () => {
    expect(isPossibly({ confidence: 0.5 })).toBe(true);
    expect(possiblyOpts({ confidence: 0.5 })).toEqual({ prefix: "possibly" });
    expect(possiblyOpts({ confidence: 0.6 })).toEqual({});
  });
});
