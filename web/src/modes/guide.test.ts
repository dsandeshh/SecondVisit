import { describe, expect, it } from "vitest";
import { BumpWatcher, closeness, Intro, INTRO_READY, nextAction } from "./guide";

function make(seen = false) {
  const said: string[] = [], shown: (string | null)[] = [];
  let remembered = false; const queue: (() => void)[] = [];
  const intro = new Intro({ say: t => said.push(t), show: t => shown.push(t), later: f => { queue.push(f); return queue.length; },
    cancelLater: () => {}, seen: () => seen, remember: () => { remembered = true; } });
  return { intro, said, shown, queue, remembered: () => remembered };
}

describe("Intro", () => {
  it("teaches one key at a time and waits for the right key", () => {
    const { intro, said, shown, queue } = make();
    expect(intro.start()).toBe(true);
    expect(said).toEqual(["Press Up to take a step."]);
    expect(intro.key("q")).toBeNull();             // wrong key: no change
    expect(intro.prompt).toBe("Press Up to take a step.");
    expect(intro.key("ArrowUp")).toBe("advance");
    expect(shown.at(-1)).toBe("Press Left or Right to turn.");   // shown at once
    expect(said).toHaveLength(1); queue.shift()!();                // spoken after a short gap
    expect(said.at(-1)).toBe("Press Left or Right to turn.");
    intro.key("ArrowRight"); queue.shift()!();
    expect(said.at(-1)).toBe("Press Q to hear what is around you.");
    intro.key("q"); queue.shift()!();
    expect(said.at(-1)).toBe(INTRO_READY);
    expect(intro.active).toBe(false);
  });
  it("Escape skips it and remembers", () => {
    const { intro, said, remembered } = make();
    intro.start();
    expect(intro.key("Escape")).toBe("skip");
    expect(intro.active).toBe(false); expect(remembered()).toBe(true);
    expect(said.at(-1)).toMatch(/Intro skipped/);
  });
  it("does not repeat for a viewer who has seen it, unless forced", () => {
    const { intro } = make(true);
    expect(intro.start()).toBe(false);
    expect(intro.start(true)).toBe(true);
  });
  it("finishing remembers", () => {
    const { intro, queue, remembered } = make();
    intro.start(); intro.key("ArrowUp"); intro.key("ArrowLeft"); intro.key("q");
    expect(remembered()).toBe(true); queue.length = 0;
  });
});

describe("nextAction", () => {
  it("names one action per phase", () => {
    expect(nextAction({ phase: "explore" })).toBe("Next: press Enter to start the rehearsal");
    expect(nextAction({ phase: "explore", intro: "Press Up to take a step." })).toBe("Next: press Up to take a step.");
    expect(nextAction({ phase: "point", pointed: false })).toMatch(/Space to confirm/);
    expect(nextAction({ phase: "quiz", answered: true })).toMatch(/Enter/);
    expect(nextAction({ phase: "summary", runNo: 1 })).toMatch(/run 2/);
  });
});

describe("recovery", () => {
  it("3 bumps within 10 s ask for help once, then count again", () => {
    const b = new BumpWatcher();
    expect([b.note(0), b.note(3000), b.note(9000)]).toEqual([false, false, true]);
    expect(b.note(9500)).toBe(false);
  });
  it("slow bumps never trigger", () => {
    const b = new BumpWatcher();
    expect([b.note(0), b.note(6000), b.note(12000), b.note(18000)]).toEqual([false, false, false, false]);
  });
  it("closeness words", () => {
    expect(closeness(14)).toBe("That's close.");
    expect(closeness(40)).toBe("Not far off.");
    expect(closeness(90)).toBe("Quite a way off.");
  });
});
