// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { AudioEngine } from "../audio/engine";
import { Speech } from "../audio/speech";
import { attachKeys, STEP_GAP_MS } from "../input/keyboard";
import { FakeAudioContext, fakeSynth, fixturePkg } from "../test/fakes";
import { World } from "../world";
import { Explore } from "./explore";
import { Session } from "./session";

// Item g: every mapped key answers at once, with a cue (bus) or a caption (say), never silence.
function rig() {
  document.body.innerHTML = `<p id="say-polite"></p><p id="say-assertive"></p><ol id="say-history"></ol><div id="stage" tabindex="0"></div>`;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  const speech = new Speech({ synth: fakeSynth() as any, Utterance: class { constructor(public text: string) {} } as any, doc: document, raf: f => f() });
  speech.setOutput("screenreader");
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
  ["q", {}], ["Q", { shiftKey: true }], ["e", {}], ["Tab", {}], ["k", {}], ["Enter", {}], ["p", {}],
];

describe("keys answer synchronously", () => {
  for (const [key, init] of KEYS) {
    it(`${JSON.stringify(key)} produces a sound, cue or caption`, () => {
      const { stage, out, s } = rig();
      if (key === "Enter") s.ex.fx.picked = null;
      const n = out.length;
      stage.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
      expect(out.length).toBeGreaterThan(n);
    });
  }
  it("p twice: paused then resumed, both spoken", () => {
    const { stage, out } = rig();
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    expect(out.filter(x => x.startsWith("say:"))).toEqual(["say:Paused. Press P to resume.", "say:Resumed."]);
  });
});
