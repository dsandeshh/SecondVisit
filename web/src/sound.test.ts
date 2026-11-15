// @vitest-environment jsdom
// Step 3 acceptance: one event bus drives the headphones, the sound ring and the captions.
import { beforeEach, describe, expect, it } from "vitest";
import { AudioEngine } from "./audio/engine";
import { Speech } from "./audio/speech";
import { toAudio } from "./audio/space";
import { VoiceOut, partsFor, type ClipStore } from "./audio/voice";
import { captionText, polar, ringLabel, ringPoint, type Cue } from "./events";
import { lineId } from "./lines";
import { spokenLower, spokenOf } from "./names";
import { fixturePkg, FakeAudioContext, fakeSynth, FakeUtterance } from "./test/fakes";
import { Captions } from "./ui/captions";
import type { Landmark, Vec2 } from "./types";

const tick = () => new Promise(r => setTimeout(r, 0));

/** An engine with a fake context whose panners are recorded. */
function rig(known: string[] = []) {
  document.body.innerHTML = `<div class="transcript__row"><p id="say-polite"></p><p id="say-dir" hidden></p></div><p id="say-assertive"></p>`;
  const speech = new Speech({ synth: fakeSynth(), Utterance: FakeUtterance as any, raf: f => f() });
  const audio = new AudioEngine(speech);
  const ctx = new FakeAudioContext();
  const panners: any[] = [];
  const mk = ctx.createPanner.bind(ctx);
  ctx.createPanner = () => { const p = mk(); panners.push(p); return p; };
  audio.ctx = ctx as unknown as AudioContext;
  (audio as any).build(ctx);
  const played: string[] = [];
  const buf = { duration: 1 } as AudioBuffer;
  const store = {
    ids: new Set(known), has: (id: string) => known.includes(id),
    get: (id: string) => { played.push(id); return Promise.resolve(buf); },
    live: (t: string) => { played.push(lineId(t)); return Promise.resolve(buf); },
  } as unknown as ClipStore;
  const voice = new VoiceOut(audio, speech, store);
  const caps = new Captions(document, speech.bus);
  const cues: Cue[] = [];
  speech.bus.subscribe(c => cues.push(c));
  return { speech, audio, panners, played, voice, caps, cues };
}

/** Signed azimuth of a panner seen from the listener, from the Web Audio coordinates only (independent of azimuth()). */
function pannerAzimuth(p: any, listener: Vec2, heading: number): number {
  const [lx, , lz] = toAudio(listener);
  const rx = p.positionX.value - lx, rz = p.positionZ.value - lz;
  const h = heading * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h);
  const right = [-fz, fx];
  return Math.atan2(rx * right[0] + rz * right[1], rx * fx + rz * fz) * 180 / Math.PI;
}

describe("one bus: sound direction equals ring position", () => {
  let r: ReturnType<typeof rig>;
  beforeEach(() => { r = rig(); });

  it("a positioned sound is one cue; the panner azimuth equals the ring angle", () => {
    const listener: Vec2 = [2, 3], heading = 40;
    r.audio.listen(listener, heading);
    let pri = 1;
    for (const at of [[6, 3], [2, 9], [-1, 0], [5, -2]] as Vec2[]) {
      r.panners.length = 0; r.cues.length = 0;
      r.audio.playBuf({ duration: 0.1 } as AudioBuffer, { bus: "cue", at, label: "pulse", pri: pri++ });
      const cue = r.cues.find(c => c.kind === "sound")!;
      expect(cue.at).toEqual(at);                           // the ring reads this very cue
      expect(r.panners).toHaveLength(1);
      const ringAz = ringPoint(r.audio.bus.listener, cue.at!).az;
      const heard = pannerAzimuth(r.panners[0], listener, heading);
      expect(Math.abs(((heard - ringAz + 540) % 360) - 180)).toBeLessThan(0.01);
    }
  });

  it("the ring keeps the true direction when it clamps a far sound", () => {
    const l = { pos: [0, 0] as Vec2, heading: 0 };
    const far = ringPoint(l, [30, 40], 7);
    expect(far.distM).toBe(7);
    expect(polar(l, far.at).az).toBeCloseTo(polar(l, [30, 40]).az, 6);
  });

  it("max two HRTF sounds at once; speech outranks ambient", () => {
    const a = (at: Vec2, pri: number) => r.audio.playBuf({ duration: 1 } as AudioBuffer, { bus: "ambient", at, pri, spatialOnly: true });
    expect(a([1, 1], 0)).not.toBeNull();
    expect(a([2, 2], 0)).not.toBeNull();
    expect(a([3, 3], 0)).toBeNull();
    expect(r.audio.budget.count).toBe(2);
    expect(r.audio.playBuf({ duration: 1 } as AudioBuffer, { bus: "voice", at: [4, 4], pri: 2, spatialOnly: true })).not.toBeNull();
    expect(r.audio.budget.count).toBe(2);
  });
});

describe("one bus: caption equals spoken text", () => {
  it("the caption is the text whose clip id is played", async () => {
    const text = "Reception desk";
    const r = rig([lineId(text)]);
    r.audio.listen([0, 0], 0);
    r.speech.say(text, 1, { at: [4, 4] });
    await tick();
    const say = r.cues.find(c => c.kind === "say")!;
    expect(document.getElementById("say-polite")!.textContent).toBe(text);
    expect(say.line).toBe(lineId(document.getElementById("say-polite")!.textContent!));
    expect(r.played).toEqual([lineId(text)]);                 // exactly that clip, none other
    expect(partsFor(say, r.voice.store).map(p => p.text)).toEqual([text]);
  });

  it("the caption carries the direction as a clock hour and an arrow turned to it", () => {
    const r = rig([]);
    r.audio.listen([0, 0], 0);
    r.speech.say("Reception desk", 1, { at: [5, 0] });          // due east: 3 o'clock, 90 degrees
    const dir = document.getElementById("say-dir")!;
    expect(dir.hidden).toBe(false);
    expect(dir.textContent).toContain("3 o'clock");
    expect(dir.dataset.az).toBe("90");
    expect((dir.querySelector(".dirarrow") as HTMLElement).style.transform).toBe("rotate(90deg)");
    r.speech.say("Walk ahead.", 2);
    expect(dir.hidden).toBe(true);                              // sentences are centred: no direction
  });

  it("possibly is a separate prefix word and a separate clip", () => {
    const r = rig([]);
    r.speech.say("Reception desk", 1, { at: [1, 1], prefix: "possibly" });
    expect(document.getElementById("say-polite")!.textContent).toBe(captionText("Reception desk", "possibly"));
    const say = r.cues.find(c => c.kind === "say")!;
    expect(partsFor(say, r.voice.store).map(p => [p.text, !!p.at])).toEqual([["possibly", false], ["Reception desk", true]]);
  });

  it("a long caption is never cut: nothing is truncated in the text", () => {
    const r = rig([]);
    const long = "Stretch 3. Keep the wall on your left for about twenty steps, then the corridor opens into the waiting room on your right.";
    r.speech.say(long, 2);
    expect(document.getElementById("say-polite")!.textContent).toBe(long);
  });
});

describe("clips play from the object", () => {
  it("a landmark name is played through a panner at toAudio(landmark.pos), by its spoken text", async () => {
    const pkg = fixturePkg();
    const lm: Landmark = { ...pkg.landmarks[0], spoken: "Front desk", label: "Front desk with a long description" };
    const r = rig([lineId("Front desk")]);
    r.audio.listen([0, 0], 0);
    r.speech.say(spokenOf(lm), 1, { at: lm.pos });
    await tick();
    expect(r.panners).toHaveLength(1);
    const [x, y, z] = toAudio(lm.pos);
    expect([r.panners[0].positionX.value, r.panners[0].positionY.value, r.panners[0].positionZ.value]).toEqual([x, y, z]);
    expect(r.played).toEqual([lineId("Front desk")]);           // the spoken name, not the label
    expect(r.panners[0].panningModel).toBe("HRTF");
  });

  it("sentences are centred: no panner", async () => {
    const r = rig([lineId("Sound on.")]);
    r.speech.say("Sound on.", 2);
    await tick();
    expect(r.panners).toHaveLength(0);
    expect(r.played).toEqual([lineId("Sound on.")]);
  });

  it("falls back to the browser voice when no clip arrives in time", async () => {
    const synth = fakeSynth();
    document.body.innerHTML = `<p id="say-polite"></p>`;
    const speech = new Speech({ synth, Utterance: FakeUtterance as any, raf: f => f() });
    const audio = new AudioEngine(speech);
    audio.ctx = new FakeAudioContext() as unknown as AudioContext; (audio as any).build(audio.ctx);
    const store = { has: () => false, get: () => Promise.resolve(null), live: () => Promise.resolve(null) } as unknown as ClipStore;
    new VoiceOut(audio, speech, store);
    speech.say("Nothing prerendered here.", 2);
    await tick(); await tick();
    expect(synth.spoken.map((u: FakeUtterance) => u.text)).toEqual(["Nothing prerendered here."]);
  });
});

describe("spoken names", () => {
  it("use Landmark.spoken, fall back to the label, lower case for the engine templates", () => {
    expect(spokenOf({ spoken: "Reception desk", label: "Wooden reception desk with a sign" })).toBe("Reception desk");
    expect(spokenOf({ spoken: null, label: "Chair" })).toBe("Chair");
    expect(spokenLower({ spoken: "Check-in counter", label: "x" })).toBe("check-in counter");
  });
  it("ring labels exist only for say and sound cues, and are short", () => {
    expect(ringLabel({ v: 1, t: "cue", ts: 0, kind: "say", text: "A very long sentence that keeps going and going" })!.length).toBeLessThanOrEqual(24);
    expect(ringLabel({ v: 1, t: "cue", ts: 0, kind: "cone" })).toBeNull();
  });
});
