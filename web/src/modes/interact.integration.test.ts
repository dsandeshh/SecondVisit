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

describe("Tab, Enter, Escape in Explore", () => {
  it("Tab picks a place and says it; Enter starts the beacon; Escape stops it and says so", () => {
    const { s, ex, said, cues } = make();
    s.pick(1);
    expect(ex.fx.picked).toBe("desk");
    expect(cues.some(c => c.kind === "pick" && c.id === "desk")).toBe(true);
    expect(said.at(-1)).toBe("Reception desk");   // the name first (from its position), then clock and steps
    s.enter();
    expect(ex.fx.beaconOn).toBe(true);
    expect(s.phase).toBe("explore");              // Enter went to the beacon, not to the rehearsal
    s.escape();
    expect(ex.fx.beaconOn).toBe(false);
    expect(said.at(-1)).toBe("Beacon off.");
    expect(ex.fx.picked).toBeNull();
    s.enter();                                    // nothing chosen: Enter starts the rehearsal as before
    expect(s.phase).toBe("rehearse");
  });
  it("Tab while going switches the target", () => {
    const pkg = fixturePkg();
    pkg.landmarks.push({ ...pkg.landmarks[0], id: "lift", kind: "elevator", label: "Elevator", spoken: "Elevator", pos: [3, 6] });
    const { s, ex } = make(pkg);
    s.pick(1); s.enter();
    const first = ex.fx.picked;
    s.pick(1);
    expect(ex.fx.picked).not.toBe(first);
    expect(ex.fx.beaconOn).toBe(true);
    s.escape();
  });
});

describe("Q around me", () => {
  it("publishes the sweep cues in order and says the names from their positions", async () => {
    const { ex, said, cues } = make();
    ex.place([16.6, 10.8], 90);
    await ex.fx.around(false);
    const kinds = cues.filter(c => c.kind === "sweep_item").map(c => c.id);
    expect(kinds[0]).toBe("start"); expect(kinds).toContain("desk"); expect(kinds.at(-1)).toBe("end");
    const say = cues.find(c => c.kind === "say" && c.text === "Reception desk")!;
    expect(say.at).toEqual([18.5, 10.8]);
    expect(said).toContain("Reception desk");
  });
  it("Shift+Q adds the clock and steps after each name", async () => {
    const { ex, said } = make();
    ex.place([16.6, 10.8], 90);
    await ex.fx.around(true);
    expect(said.some(t => /^\d+ o'clock, (\d+ steps?|within reach)\.$/.test(t))).toBe(true);
  });
  it("nothing in range says so", async () => {
    const { ex, said } = make();
    ex.place([19.5, 0.5], 0);
    await ex.fx.around(false);
    expect(said.at(-1)).toBe("Nothing within 8 metres. Try E for ahead.");
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
