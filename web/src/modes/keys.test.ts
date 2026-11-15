// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { AudioEngine } from "../audio/engine";
import { Speech } from "../audio/speech";
import { attachKeys, STEP_GAP_MS } from "../input/keyboard";
import { FakeAudioContext, fixturePkg, gridPkg } from "../test/fakes";
import { World } from "../world";
import { Explore } from "./explore";
import { Session } from "./session";

// Item g: every mapped key answers at once, with a cue (bus) or a caption (say), never silence.
function rig() {
  document.body.innerHTML = `<p id="say-polite"></p><p id="say-assertive"></p><ol id="say-history"></ol><div id="stage" tabindex="0"></div>`;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  const speech = new Speech({ doc: document, raf: f => f() });
  const out: string[] = [];
  speech.onSay = t => out.push("say:" + t);
  speech.bus.subscribe(c => out.push("cue:" + (c as any).kind));
  const audio = new AudioEngine(speech);
  for (const m of ["play", "cue", "playBuf"] as const) { const o = (audio as any)[m].bind(audio); (audio as any)[m] = (...a: any[]) => { out.push("sound:" + m); return o(...a); }; }
  audio.ctx = new FakeAudioContext() as any;
  audio.buses = {} as any;   // landmark sounds exist, as after Start
  const hooks = {};
  const ex = new Explore(new World(fixturePkg()), audio, speech, hooks);
  const s = new Session(ex, fixturePkg(), speech, hooks, { now: () => 0, threadId: "t", publish: () => {}, fetchCoach: async () => null, audioRunning: () => true });
  ex.begin();
  let t = 0;
  const stage = document.getElementById("stage")!;
  attachKeys(stage, s, () => (t += STEP_GAP_MS * 3));
  return { stage, out, s };
}

const KEYS: [string, KeyboardEventInit][] = [
  ["ArrowUp", {}], ["ArrowDown", {}], ["ArrowLeft", {}], ["ArrowRight", {}],
  [" ", {}], ["h", {}], ["w", {}], ["b", {}], ["m", {}], ["s", {}], ["S", { shiftKey: true }],
  ["q", {}], ["Q", { shiftKey: true }], ["e", {}], ["Tab", {}], ["Tab", { shiftKey: true }], ["k", {}], ["Enter", {}], ["p", {}],
  ["Escape", {}], ["B", {}],
];

describe("keys answer synchronously", () => {
  for (const [key, init] of KEYS) {
    it(`${JSON.stringify(key)} produces a sound, cue or caption`, () => {
      const { stage, out, s } = rig();
      if (key === "Enter") s.ex.fx.picked = null;
      const n = out.length, t0 = performance.now();
      stage.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
      expect(out.length).toBeGreaterThan(n);              // synchronously, inside the key's own event
      expect(performance.now() - t0).toBeLessThan(100);
    });
  }
  it("Enter with a place highlighted says 'Target set', Escape then says 'Target cleared', B says the beacon state", () => {
    const { stage, out, s } = rig();
    const key = (k: string, o: KeyboardEventInit = {}) => stage.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...o }));
    key("Tab"); key("Enter");
    expect(out.filter(x => x.startsWith("say:")).at(-1)).toMatch(/^say:Target set, /);
    s.ex.fx.setTarget({ id: "elsewhere", kind: "sign", at: [2, 2], name: "Sign", fixed: true });
    key("Escape"); expect(out.filter(x => x.startsWith("say:")).at(-1)).toMatch(/^say:Target cleared\./);
    key("b"); expect(out.filter(x => x.startsWith("say:")).at(-1)).toBe("say:Beacon off.");
    key("b"); expect(out.filter(x => x.startsWith("say:")).at(-1)).toBe("say:Beacon on.");
  });
  it("? answers at once: the key card opens and speaks", async () => {
    const { stage } = rig();
    const { mountKeyCard, KEYCARD_LINE } = await import("../pages/keycard");
    document.body.dataset.page = "inside";
    const said: string[] = [];
    const c = mountKeyCard(document, stage, t => said.push(t));
    const t0 = performance.now();
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    expect(c.open).toBe(true); expect(said).toEqual([KEYCARD_LINE]);
    expect(performance.now() - t0).toBeLessThan(100);
    c.hide();
    delete document.body.dataset.page;
  });
  it("p twice: paused then resumed, both spoken", () => {
    const { stage, out } = rig();
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    expect(out.filter(x => x.startsWith("say:"))).toEqual(["say:Paused. Press P to resume.", "say:Resumed."]);
  });
});

describe("one cane tick per Up press", () => {
  function tickRig(rows?: string[]) {
    document.body.innerHTML = `<p id="say-polite"></p><p id="say-assertive"></p><ol id="say-history"></ol><div id="stage" tabindex="0"></div>`;
    const speech = new Speech({ doc: document, raf: f => f() });
    const audio = new AudioEngine(speech);
    audio.ctx = new FakeAudioContext() as any; (audio as any).build(audio.ctx);
    let ticks = 0, steps = 0;
    const play = audio.play.bind(audio);
    audio.play = ((k: any, o: any) => { if (k === "step") ticks++; return play(k, o); }) as any;
    const pkg = rows ? gridPkg(rows, { entrances: [{ id: "e", label: "Door", pos: [1.5, 1.5], heading_deg: 90 }] }) : fixturePkg();
    const hooks = {};
    const ex = new Explore(new World(pkg), audio, speech, hooks);
    const s = new Session(ex, pkg, speech, hooks, { now: () => 0, threadId: "t", publish: () => {}, fetchCoach: async () => null, audioRunning: () => true });
    const st = ex.step.bind(ex); ex.step = (d: 1 | -1) => { steps++; st(d); };
    ex.begin();
    const clock = { t: 0 };
    const stage = document.getElementById("stage")!;
    attachKeys(stage, s, () => clock.t);
    const up = (repeat = false) => stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, repeat }));
    return { up, clock, ticks: () => ticks, steps: () => steps, ex };
  }
  it("fresh presses, slow or fast, each give exactly one tick; held repeats tick only when they step", () => {
    const r = tickRig();
    const times = [1000, 1100, 1200, 2000, 2050, 3000];
    for (const t of times) { r.clock.t = t; r.up(); }
    expect(r.ticks()).toBe(times.length);
    expect(r.steps()).toBe(3);                         // the step gap still holds: one press, one step at most
    r.clock.t = 3100; r.up(true); r.clock.t = 3200; r.up(true);   // auto repeat inside the gap: no step, no tick
    expect(r.ticks()).toBe(times.length);
    r.clock.t = 3500; r.up(true);                      // auto repeat that steps: its one tick
    expect(r.ticks()).toBe(times.length + 1);
  });
  it("a blocked step still ticks once, then the bump", () => {
    const r = tickRig(["####", "#..#", "####"]);
    for (let i = 0; i < 5; i++) { r.clock.t = 1000 * (i + 1); r.up(); }
    expect(r.ticks()).toBe(5);
  });
});
