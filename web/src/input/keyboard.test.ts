// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { attachFocusGuard, attachKeys, type KeyActions } from "./keyboard";

function actions(): KeyActions & { log: string[] } {
  const log: string[] = [];
  const f = (k: string) => (..._a: unknown[]) => { log.push(k); };
  return { log, step: (d) => log.push(d > 0 ? "up" : "down"), turn: f("turn"), sweep: f("sweep"),
    repeat: f("repeat"), heading: f("heading"), where: f("where"), hint: f("hint"), mono: f("mono"),
    swap: f("swap"), rate: f("rate"), any: () => {} };
}

const key = (el: Element, k: string, repeat = false) => {
  const e = new KeyboardEvent("keydown", { key: k, repeat, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};

describe("keyboard", () => {
  it("key repeat throttled", () => {
    const stage = document.createElement("div");
    let t = 0;
    const a = actions();
    attachKeys(stage, a, () => t);
    for (let i = 0; i < 30; i++) { key(stage, "ArrowUp", i > 0); t += 33; }
    const steps = a.log.filter(x => x === "up").length;
    expect(steps).toBeGreaterThanOrEqual(1);
    expect(steps).toBeLessThanOrEqual(3);
  });

  it("prevents scrolling on arrows and Space, ignores repeat for Space and H", () => {
    const stage = document.createElement("div");
    const a = actions();
    attachKeys(stage, a, () => 0);
    expect(key(stage, "ArrowDown").defaultPrevented).toBe(true);
    expect(key(stage, " ").defaultPrevented).toBe(true);
    key(stage, " ", true);
    key(stage, "h"); key(stage, "h", true);
    expect(a.log.filter(x => x === "repeat").length).toBe(1);
    expect(a.log.filter(x => x === "heading").length).toBe(1);
  });

  it("maps the other keys", () => {
    const stage = document.createElement("div");
    const a = actions();
    attachKeys(stage, a, () => 0);
    for (const k of ["ArrowLeft", "w", "b", "m", "s", "+", "-", "a"]) key(stage, k);
    expect(a.log).toEqual(["turn", "where", "hint", "mono", "swap", "rate", "rate", "sweep"]);
  });

  it("blur pauses", () => {
    const say = vi.fn();
    const timer = { stop: vi.fn(), start: vi.fn() };
    attachFocusGuard(window, { say, timer, active: () => true });
    window.dispatchEvent(new Event("blur"));
    expect(say).toHaveBeenCalledWith("Paused. Focus lost.", 3);
    expect(timer.stop).toHaveBeenCalled();
    window.dispatchEvent(new Event("focus"));
    expect(timer.start).toHaveBeenCalled();
  });
});
