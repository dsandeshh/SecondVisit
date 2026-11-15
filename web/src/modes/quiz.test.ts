import { describe, expect, it, vi } from "vitest";
import { fixturePkg } from "../test/fakes";
import { buildQuiz, QuizSession } from "./quiz";

const route = () => fixturePkg().routes[0];

describe("quiz", () => {
  it("quiz questions use real numbers", () => {
    const r = route();
    const qs = buildQuiz(r, 1);
    const steps = qs.find(q => q.kind === "steps")!;
    expect(steps.options[steps.answer]).toBe(String(r.segments[steps.seg].steps));
    const real = new Set(r.segments.map(s => String(s.steps)));
    for (const o of steps.options) expect(real.has(o)).toBe(true);
  });
  it("has 3 questions, none about the destination clock hour", () => {
    const qs = buildQuiz(route(), 1);
    expect(qs.length).toBe(3);
    expect(qs.every(q => !/o'clock/.test(q.q))).toBe(true);
    for (const q of qs) { expect(q.options.length).toBeGreaterThanOrEqual(2); expect(q.options.length).toBeLessThanOrEqual(4); }
  });
  it("answers match the route", () => {
    const r = route();
    for (const q of buildQuiz(r, 2)) {
      const s = r.segments[q.seg];
      if (q.kind === "wall") expect(q.options[q.answer].toLowerCase()).toContain(s.wall_side === "none" ? "no wall" : s.wall_side);
      if (q.kind === "turn") expect(q.options[q.answer].toLowerCase()).toContain(s.turn_after === "none" ? "no turn" : s.turn_after);
    }
  });
  it("session speaks options, scores, repeats with R", () => {
    const r = route();
    const say = vi.fn(), log: any[] = [];
    const s = new QuizSession(buildQuiz(r, 1), say, e => log.push(e));
    s.ask();
    expect(say.mock.calls[0][0]).toMatch(/Question 1 of 3\..*1, .*2, /);
    s.repeat();
    expect(say).toHaveBeenCalledTimes(2);
    const q = s.current!;
    const wrong = (q.answer + 1) % q.options.length;
    expect(s.answer(wrong + 1)).toBe(false);
    expect(log[0]).toEqual({ q: q.q, seg: q.seg, correct: false });
    expect(say.mock.calls.at(-1)![0]).toMatch(/^Not this one\./);
    s.next(); s.ask();
    expect(s.answer(s.current!.answer + 1)).toBe(true);
    expect(say.mock.calls.at(-1)![0]).toMatch(/^Correct\./);
    expect(s.answer(1)).toBe(false); // already answered: ignored
    expect(log.length).toBe(2);
  });
  it("ignores keys outside the option range", () => {
    const say = vi.fn(), log: any[] = [];
    const s = new QuizSession(buildQuiz(route(), 1), say, e => log.push(e));
    s.ask();
    s.answer(9);
    expect(log.length).toBe(0);
  });
});
