// @vitest-environment jsdom
// The Top 8 wired together: keys -> Session -> Explore.fx -> Speech and the cue bus (review/agent5_interaction.md 4.12).
import { describe, expect, it, vi } from "vitest";
import { AudioEngine } from "../audio/engine";
import { Speech } from "../audio/speech";
import { attachKeys } from "../input/keyboard";
import type { Cue } from "../events";
import { fixturePkg, FakeAudioContext, gridPkg } from "../test/fakes";
import { World } from "../world";
import { Explore } from "./explore";
import { Session } from "./session";
import { BURST_HOLD_S, BURST_PULSES } from "../audio/continuous";
import type { BuildingPackage } from "../types";

function make(pkg: BuildingPackage = fixturePkg()) {
  document.body.innerHTML = `<p id="say-polite"></p><p id="say-assertive"></p><ol id="say-history"></ol><div id="stage" tabindex="0"></div>`;
  const speech = new Speech({ doc: document, raf: f => f() });
  const said: string[] = [];
  speech.onSay = t => said.push(t);
  const audio = new AudioEngine(speech);
  audio.ctx = new FakeAudioContext() as unknown as AudioContext; (audio as any).build(audio.ctx);
  const cues: Cue[] = [];
  speech.bus.subscribe(c => cues.push(c));
  const clock = { t: 0 };
  const hooks = { now: () => clock.t };
  const ex = new Explore(new World(pkg), audio, speech, hooks);
  const s = new Session(ex, pkg, speech, hooks, { now: () => clock.t, threadId: "th", publish: () => {}, fetchCoach: async () => null, audioRunning: () => true });
  ex.begin();
  return { s, ex, said, cues, clock, speech, pkg };
}

describe("beacon is a hint in Rehearse", () => {
  it("Enter in Rehearse logs a hint and never starts the scheduler", () => {
    const { s, ex } = make();
    s.enter();                                   // Explore: no place chosen, so this starts the rehearsal
    expect(s.phase).toBe("rehearse");
    const spy = vi.spyOn(globalThis, "setInterval");
    s.enter();
    expect(s.run!.log.events.some(e => e.kind === "hint")).toBe(true);
    expect(ex.fx.beaconOn).toBe(false);
    expect(spy.mock.calls.some(c => c[1] === 25)).toBe(false);
    spy.mockRestore();
  });
});

describe("the beacon by mode (human decision 15 Nov): Explore continuous and toggled by B, Rehearse only a 3 pulse B burst", () => {
  /** Advance the audio clock and the fake timers together (the scheduler's 40 ms interval runs on them). */
  const advance = (ex: Explore, sec: number) => {
    const c = ex.audio.ctx as any;
    for (let i = 0; i < Math.round(sec / 0.04); i++) { c.currentTime += 0.04; vi.advanceTimersByTime(40); }
  };
  const intoRehearse = () => {
    vi.useFakeTimers();
    const m = make(); m.ex.place([3, 3], 0);
    m.s.enter();
    expect(m.s.phase).toBe("rehearse");
    return m;
  };

  it("Explore: on at start, B toggles it", () => {
    vi.useFakeTimers();
    try {
      const { s, ex, said } = make(); ex.place([3, 3], 0);
      expect(ex.cont.beaconOn).toBe(true);
      advance(ex, 1);
      expect(ex.cont.beaconRunning).toBe(true);
      const n = ex.cont.pulses; expect(n).toBeGreaterThan(0);
      s.beacon(); expect(said.at(-1)).toBe("Beacon off.");
      const n1 = ex.cont.pulses; advance(ex, 2); expect(ex.cont.pulses).toBe(n1);
      s.beacon(); expect(said.at(-1)).toBe("Beacon on.");
      advance(ex, 1); expect(ex.cont.pulses).toBeGreaterThan(n1);
    } finally { vi.useRealTimers(); }
  });

  it("Rehearse: no continuous beacon at any point; B is a hint plus exactly 3 pulses, then silence", () => {
    try {
      const { s, ex } = intoRehearse();
      for (let i = 0; i < 50; i++) { advance(ex, 0.2); expect(ex.cont.beaconRunning).toBe(false); }
      expect(ex.cont.pulses).toBe(0);
      s.beacon();
      expect(s.run!.log.events.filter(e => e.kind === "hint")).toHaveLength(1);
      advance(ex, 5);
      expect(ex.cont.pulses).toBe(BURST_PULSES);
      expect(BURST_PULSES).toBe(3);
      advance(ex, 20);
      expect(ex.cont.pulses).toBe(3);                         // well past the burst: nothing more
      expect(ex.cont.beaconRunning).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("Rehearse: holding or mashing B never extends a burst into continuous pulsing", () => {
    try {
      const { s, ex } = intoRehearse();
      s.beacon();
      for (let i = 0; i < 20; i++) { advance(ex, 0.08); s.beacon(); }   // 1.6 s of mashing, inside one burst's hold
      expect(ex.cont.pulses).toBe(3);
      expect(s.run!.log.events.filter(e => e.kind === "hint")).toHaveLength(1);
      // a whole minute of B every 100 ms: one burst per hold, never the 1 to 4 per second of a beacon
      const n = ex.cont.pulses, t0 = (ex.audio.ctx as any).currentTime;
      for (let i = 0; i < 600; i++) { advance(ex, 0.1); s.beacon(); }
      const rate = (ex.cont.pulses - n) / ((ex.audio.ctx as any).currentTime - t0);
      expect(rate).toBeLessThanOrEqual(BURST_PULSES / BURST_HOLD_S + 0.1);
      expect(ex.cont.beaconRunning).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("Rehearse: Enter is the hint and never sets a target, even with a place highlighted by Tab", () => {
    try {
      const { s, ex, said } = intoRehearse();
      s.pick(1);
      expect(ex.fx.picked).not.toBeNull();
      const n = said.length;
      s.enter();
      expect(ex.fx.target).toBeNull();
      expect(said.slice(n).some(t => t.startsWith("Target set"))).toBe(false);
      expect(s.run!.log.events.some(e => e.kind === "hint")).toBe(true);
      advance(ex, 5);
      expect(ex.cont.pulses).toBe(3);
      expect(ex.cont.beaconRunning).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("Explore to Rehearse stops the beacon at once; back in Explore the last on/off choice returns", () => {
    vi.useFakeTimers();
    try {
      const { s, ex } = make(); ex.place([3, 3], 0);
      advance(ex, 1);
      expect(ex.cont.beaconRunning).toBe(true);
      s.enter();
      expect(ex.cont.beaconRunning).toBe(false);              // immediately, before any tick
      advance(ex, 3); expect(ex.cont.beaconRunning).toBe(false);
      ex.rehearse = false; ex.place([3, 3], 0);               // back to Explore: on, as it was
      advance(ex, 1); expect(ex.cont.beaconRunning).toBe(true);
      ex.cont.beaconOn = false;                               // the user had turned it off in Explore
      ex.rehearse = true; advance(ex, 1); expect(ex.cont.beaconRunning).toBe(false);
      ex.rehearse = false; const n = ex.cont.pulses; advance(ex, 2);
      expect(ex.cont.pulses).toBe(n);                         // still off
      expect(ex.cont.beaconOn).toBe(false);
    } finally { vi.useRealTimers(); }
  });

});

describe("Tab, Enter, Escape in Explore: the beacon's target", () => {
  const two = () => { const pkg = fixturePkg(); pkg.landmarks.push({ ...pkg.landmarks[0], id: "lift", kind: "elevator", label: "Elevator", spoken: "Elevator", confidence: 0.4, pos: [3, 6] }); return pkg; };
  it("Tab says name, clock and steps in one line; Enter sets the target; Escape clears it back to the destination", () => {
    const { s, ex, said, cues } = make(two());
    document.body.insertAdjacentHTML("beforeend", `<p id="target-line"></p>`);
    s.pick(1);
    expect(ex.fx.picked).toBe("desk");                     // today's destination comes first
    expect(cues.some(c => c.kind === "pick" && c.id === "desk")).toBe(true);
    expect(said.at(-1)).toMatch(/^Reception desk, \d+ o'clock, (\d+ steps?|within reach)\.$/);
    s.pick(1);
    expect(ex.fx.picked).toBe("lift");
    s.enter();
    expect(s.phase).toBe("explore");                       // Enter set the target, it did not start the rehearsal
    expect(said.at(-1)).toBe("Target set, Elevator.");
    expect(ex.fx.beaconTarget?.id).toBe("lift");
    expect(document.getElementById("target-line")!.textContent).toBe("Target: Elevator");
    s.escape();
    expect(said.at(-1)).toBe("Target cleared. Heading to Reception desk.");
    expect(ex.fx.beaconTarget?.id).toBe("desk");
    expect(document.getElementById("target-line")!.textContent).toBe("Target: Reception desk (destination)");
    s.enter();                                             // nothing highlighted: Enter starts the rehearsal as before
    expect(s.phase).toBe("rehearse");
  });
  it("the beacon plays continuously from the target, with no key; B turns it off and on, and says so", () => {
    const { s, ex, said, cues } = make();
    ex.place([3, 3], 0);
    const n0 = ex.cont.pulses;
    ex.cont.tick();
    (ex.audio.ctx as any).currentTime = 1; ex.cont.tick();
    expect(ex.cont.pulses).toBeGreaterThan(n0);
    expect(cues.some(c => c.kind === "pulse")).toBe(true);
    s.beacon();
    expect(said.at(-1)).toBe("Beacon off.");
    const n1 = ex.cont.pulses;
    (ex.audio.ctx as any).currentTime = 2; ex.cont.tick();
    expect(ex.cont.pulses).toBe(n1);
    s.beacon();
    expect(said.at(-1)).toBe("Beacon on.");
    (ex.audio.ctx as any).currentTime = 3; ex.cont.tick();
    expect(ex.cont.pulses).toBeGreaterThan(n1);
  });
});

describe("Q around me: the nearest 4 places", () => {
  const many = () => {
    const pkg = fixturePkg();
    const base = pkg.landmarks[0];
    for (const [i, p] of ([[3, 6], [6, 3], [9, 9], [12, 4], [2, 14]] as [number, number][]).entries())
      pkg.landmarks.push({ ...base, id: `x${i}`, kind: "sign", label: `Sign ${i}`, spoken: `Sign ${i}`, confidence: 0.3, pos: p });
    return pkg;
  };
  it("says each as '<name>, <clock> o'clock, <N> steps.' from its position, nearest first, at most 4", async () => {
    const { ex, said, cues } = make(many());
    ex.place([16.6, 10.8], 90);
    const n = said.length;
    await ex.fx.around(false);
    const lines = said.slice(n);
    expect(lines).toHaveLength(4);
    for (const l of lines) expect(l).toMatch(/^[A-Z][^,]*, \d+ o'clock, (\d+ steps?|within reach)\.$/);
    expect(lines[0]).toMatch(/^Reception desk, /);
    const kinds = cues.filter(c => c.kind === "sweep_item").map(c => c.id);
    expect(kinds[0]).toBe("start"); expect(kinds).toContain("desk"); expect(kinds.at(-1)).toBe("end");
    const say = cues.find(c => c.kind === "say" && c.text?.startsWith("Reception desk"))!;
    expect(say.at).toEqual([18.5, 10.8]);
  });
  it("never says or shows 'possibly' in the Q list or the E line, even for low confidence places", async () => {
    const { ex, said, cues } = make(many());
    ex.place([4, 5], 45);
    const n = said.length, nc = cues.length;
    await ex.fx.around(true);
    ex.fx.ahead();
    const out = said.slice(n);
    expect(out.length).toBeGreaterThan(4);
    for (const t of out) expect(t).not.toMatch(/possibly/i);
    for (const c of cues.slice(nc).filter(c => c.kind === "say")) { expect("prefix" in c).toBe(false); expect(c.text ?? "").not.toMatch(/possibly/i); }
    expect(document.getElementById("say-polite")!.textContent).not.toMatch(/possibly/i);
  });
});

describe("E ahead: one line, fixed shape", () => {
  it("open distance first, then up to 3 things as '<thing> at <clock> o'clock, <N> metres.'", () => {
    const { ex, said } = make();
    ex.place([3, 3], 0);
    ex.fx.ahead();
    const t = said.at(-1)!;
    expect(t).toMatch(/^Clear (over 12 metres|under 1 metre|1 metre|\d+ metres)\.( [A-Z][^.]* at \d+ o'clock, (under 1 metre|1 metre|\d+ metres)\.){0,3}$/);
    for (const clause of t.split(". ")) expect(clause.split(" ").length).toBeLessThan(12);
  });
});

describe("bump", () => {
  const corridor = () => gridPkg(["######", "#....#", "######"], { entrances: [{ id: "e", label: "Door", pos: [1.5, 1.5], heading_deg: 90 }] });
  it("a thud, a bump cue with the word, the name from the contact point, and not again within 2 s", async () => {
    vi.useFakeTimers();
    const { ex, said, cues, clock } = make(corridor());
    for (let i = 0; i < 6; i++) ex.step(1);
    const bumps = cues.filter(c => c.kind === "bump");
    expect(bumps.length).toBeGreaterThanOrEqual(1);
    expect(bumps[0].label).toBe("wall");
    expect(bumps[0].at![0]).toBeGreaterThan(4.9);
    await vi.advanceTimersByTimeAsync(300);
    expect(said.filter(t => t === "wall")).toHaveLength(1);
    clock.t = 800; ex.step(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(said.filter(t => t === "wall")).toHaveLength(1);     // same wall within 2 s: thud only
    clock.t = 3500; ex.step(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(said.filter(t => t === "wall")).toHaveLength(2);
    vi.useRealTimers();
  });
});

describe("keys", () => {
  it("Q, E, Tab, Escape, K, S and Shift+S reach the right actions; repeats are ignored", () => {
    const calls: string[] = [];
    const a: any = new Proxy({}, { get: (_, k: string) => (...args: unknown[]) => { calls.push(`${k}${args.length ? ":" + args.join(",") : ""}`); } });
    const stage = document.createElement("div"); document.body.append(stage);
    attachKeys(stage, a);
    const press = (key: string, o: KeyboardEventInit = {}) => stage.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...o }));
    press("q"); press("Q", { shiftKey: true }); press("e"); press("Tab"); press("Tab", { shiftKey: true }); press("Escape"); press("k"); press("s"); press("S", { shiftKey: true });
    press("q", { repeat: true });
    expect(calls.filter(c => !c.startsWith("any"))).toEqual(["around:false", "around:true", "ahead", "pick:1", "pick:-1", "escape", "keys", "source", "swap"]);
    expect(press("Tab")).toBe(false);                            // default prevented while the stage has focus
  });
  it("any key cuts speech", () => {
    const { s, speech } = make();
    const stop = vi.spyOn(speech, "stop");
    s.any("w");
    expect(stop).toHaveBeenCalled();
  });
});
