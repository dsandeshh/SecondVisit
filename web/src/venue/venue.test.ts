import { describe, expect, it } from "vitest";
import type { PortfolioRow } from "../types";
import { beforeAfter, floorplanNote, heatBin, parseSse, sortRows, totalBuild, unscored } from "./model";

const row = (o: Partial<PortfolioRow>): PortfolioRow => ({ sid: "s", name: "n", address: "", costar_property_id: "", costar: {},
  rank: null, total: null, parts: {}, build_s: 1, assumed_entrance: true, skipped: null, error: null, tour_url: "", ...o });

describe("venue model", () => {
  it("heat bins are fixed fractions and zero is unfilled", () => {
    expect(heatBin(0, 100)).toBe(-1);
    expect(heatBin(2, 100)).toBe(0);
    expect(heatBin(4, 100)).toBe(1);
    expect(heatBin(10, 100)).toBe(2);
    expect(heatBin(11, 100)).toBe(3);
  });
  it("before and after writes change as words", () => {
    const rows = beforeAfter({ score: 50, arrival_rate: 0.6, open_m: 7, turns: 5 }, { score: 62, arrival_rate: 0.8, open_m: 2, turns: 3 });
    expect(rows[0].change).toBe("up 12.0");
    expect(rows[1]).toMatchObject({ tag: "simulated", now: "60%", after: "80%", change: "up 20.0 points" });
    expect(rows[2].change).toBe("down 5.0 m");
  });
  it("floor plan note when either file is missing (R16)", () => {
    expect(floorplanNote(true, true)).toBeNull();
    expect(floorplanNote(true, false)).toBe("Floor plan not available");
    expect(floorplanNote(false, true)).toBe("Floor plan not available");
  });
  it("parses SSE across chunk boundaries", () => {
    const a = parseSse('data: {"type":"start"}\n\ndata: {"ty');
    expect(a.events).toEqual([{ type: "start" }]);
    expect(parseSse(a.rest + 'pe":"final"}\n\n').events).toEqual([{ type: "final" }]);
  });
  it("sorts scored rows only; skipped and error rows are listed apart with reasons", () => {
    const rows = [row({ sid: "a", total: 50, rank: 2 }), row({ sid: "b", total: 70, rank: 1 }),
      row({ sid: "c", skipped: "no walls" }), row({ sid: "d", error: "KeyError: x" })];
    expect(sortRows(rows, "total", true).map((r) => r.sid)).toEqual(["b", "a"]);
    expect(sortRows(rows, "rank", false).map((r) => r.sid)).toEqual(["b", "a"]);
    expect(unscored(rows)).toEqual([{ sid: "c", name: "n", kind: "skipped", why: "no walls" },
      { sid: "d", name: "n", kind: "error", why: "KeyError: x" }]);
  });
  it("total build time in words", () => {
    expect(totalBuild([row({ build_s: 100 }), row({ build_s: 20 })])).toBe("2 min 0 s");
  });
});
