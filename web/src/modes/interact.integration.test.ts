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
    for (const c of cues.slice(nc).filter(c => c.kind === "say")) { expect(c.prefix).toBeUndefined(); }
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
