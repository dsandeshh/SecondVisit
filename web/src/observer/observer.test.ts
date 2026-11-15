import { describe, expect, it } from "vitest";
import { ObserverState } from "./observer";
import type { ObsMsg } from "./protocol";

const hello = (run: number): ObsMsg => ({ v: 1, t: "hello", session: "s", building_id: "fixture", route_id: "r", run, mode: "app" });
const pose = (ts: number): ObsMsg => ({ v: 1, t: "pose", ts, pos: [ts, 0], heading: 0, cane_deg: 0 });

describe("ObserverState", () => {
  it("keeps trails per run", () => {
    const s = new ObserverState();
    s.apply(hello(1)); [1, 2, 3].forEach((t) => s.apply(pose(t)));
    s.apply(hello(2)); [4, 5].forEach((t) => s.apply(pose(t)));
    expect(s.trails[1].length).toBe(3);
    expect(s.trails[2].length).toBe(2);
  });

  it("repeated hello for the same run keeps the trail", () => {
    const s = new ObserverState();
    s.apply(hello(1)); s.apply(pose(1)); s.apply(hello(1)); s.apply(pose(2));
    expect(s.trails[1].length).toBe(2);
  });

  it("prunes taps older than 300 ms on apply", () => {
    const s = new ObserverState();
    s.apply({ v: 1, t: "tap", ts: 1000, at: [1, 1], code: 1 });
    s.apply({ v: 1, t: "tap", ts: 1200, at: [2, 1], code: 1 });
    expect(s.taps.length).toBe(2);
    s.apply(pose(1350));
    expect(s.taps.map((t) => t.ts)).toEqual([1200]);
  });

  it("tracks say, quiz, point, plan, end", () => {
    const s = new ObserverState();
    s.apply({ v: 1, t: "say", ts: 1, text: "Go", pri: 1 });
    s.apply({ v: 1, t: "quiz", ts: 2, q: "q1", seg: 0, correct: false });
    s.apply({ v: 1, t: "end", ts: 3, run: 1, arrived: true, time_s: 60, bumps: 2, off_route: 1, quiz_correct: 2, quiz_total: 3, point_error_deg: 30 });
    expect(s.lastSay).toBe("Go");
    expect(s.quiz).toEqual([{ q: "q1", seg: 0, correct: false }]);
    expect(s.summary[1].bumps).toBe(2);
  });
});

import { validMsg } from "./protocol";
import { tableRows } from "./observer";

describe("validation", () => {
  it("rejects malformed messages and leaves state unchanged", () => {
    const s = new ObserverState();
    s.apply(hello(1));
    const bad: unknown[] = [null, 5, { t: "pose" }, { v: 2, t: "say", ts: 1, text: "x", pri: 1 },
      { v: 1, t: "nope", ts: 1 }, { v: 1, t: "pose", ts: 1, pos: [NaN, 1], heading: 0, cane_deg: 0 },
      { v: 1, t: "pose", ts: 1, pos: "ab", heading: 0, cane_deg: 0 },
      { v: 1, t: "tap", ts: 1, at: [1], code: 1 }, { v: 1, t: "say", ts: 1, text: 5, pri: 1 }];
    for (const m of bad) { expect(validMsg(m)).toBe(false); expect(() => s.apply(m as never)).not.toThrow(); }
    expect(s.trails[1]).toEqual([]);
    expect(s.lastSay).toBe("");
    expect(s.pose).toBeNull();
  });
  it("table rows coerce numbers so markup cannot pass through", () => {
    const s = new ObserverState();
    s.apply({ v: 1, t: "end", ts: 1, run: 1, arrived: true, time_s: 5, bumps: "<img src=x>" as never, off_route: 0, quiz_correct: 1, quiz_total: 2, point_error_deg: null });
    expect(s.summary[1]).toBeUndefined();
    expect(tableRows({ 1: { v: 1, t: "end", ts: 1, run: 1, arrived: true, time_s: 5, bumps: "<b>" as never, off_route: 0, quiz_correct: 1, quiz_total: 2, point_error_deg: null } })
      .flat().join("|")).not.toContain("<");
  });
});
