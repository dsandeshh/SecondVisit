import { describe, expect, it, vi } from "vitest";
import { chooseFocus, fetchCoach, makePlan, scriptedCoach, tally, toWireLog } from "./coach";
import type { RunLog } from "../types";

const log = (events: any[] = [], quiz: any[] = []): RunLog => ({ thread_id: "t", route_id: "r1", events, quiz, point: [] });
const ev = (kind: string, seg: number) => ({ t: 1, seg, kind, pos: [0, 0] as [number, number] });

describe("coach rules (scripted mirror)", () => {
  it("focus on failed quiz", () => {
    expect(chooseFocus(log([], [{ q: "x", seg: 2, correct: false }]), 3)).toBe(2);
  });
  it("no errors gives -1 and a plain plan", () => {
    expect(chooseFocus(log(), 3)).toBe(-1);
    expect(makePlan(-1)).toEqual({ start_segment: 0, repeat_segment: null, extra_cues: false, speech_rate: 1 });
  });
  it("weights and ties", () => {
    expect(tally(log([ev("off_route", 0), ev("hesitate", 1), ev("hint", 1), ev("bump", 2)]), 3)).toEqual([1.5, 2, 0.5]);
    expect(chooseFocus(log([ev("hesitate", 0), ev("hesitate", 2)]), 3)).toBe(0);
  });
  it("plan differs after a failed quiz", () => {
    const p = makePlan(2);
    expect(p).toEqual({ start_segment: 1, repeat_segment: 2, extra_cues: true, speech_rate: 0.9 });
    expect(makePlan(0).start_segment).toBe(0);
    expect(p).not.toEqual(makePlan(-1));
  });
  it("scripted coach is labelled and grounded in segment numbers", () => {
    const c = scriptedCoach(log([], [{ q: "x", seg: 1, correct: false }]), 3);
    expect(c.source).toBe("scripted");
    expect(c.focus_segment).toBe(1);
    expect(c.line).toContain("stretch 2");
  });
  it("wire log maps hint to hesitate", () => {
    expect(toWireLog(log([ev("hint", 1)])).events[0].kind).toBe("hesitate");
  });
  it("fetchCoach falls back to null on failure and validates the reply", async () => {
    const bad = vi.fn(async () => { throw new Error("down"); });
    expect(await fetchCoach(log(), "fixture", 3, bad as any)).toBeNull();
    const junk = vi.fn(async () => ({ ok: true, json: async () => ({ plan: { start_segment: "x" } }) }));
    expect(await fetchCoach(log(), "fixture", 3, junk as any)).toBeNull();
    const ok = vi.fn(async () => ({ ok: true, json: async () => ({ plan: makePlan(1), focus_segment: 1, line: "Let's go again." }) }));
    const r = await fetchCoach(log(), "fixture", 3, ok as any);
    expect(r?.source).toBe("agent");
    const body = JSON.parse((ok.mock.calls[0] as any)[1].body);
    expect(body.building_id).toBe("fixture");
    expect(body.route_id).toBe("r1");
  });
});
