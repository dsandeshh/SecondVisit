// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fakeSynth, FakeUtterance } from "../test/fakes";
import { Speech } from "./speech";

function setup(voices: unknown[] = []) {
  document.body.innerHTML = `<p id="say-polite" aria-live="off"></p><p id="say-assertive" aria-live="off"></p>
    <ol id="say-history"></ol>`;
  const synth = fakeSynth(voices);
  const sp = new Speech({ synth, Utterance: FakeUtterance as any, raf: (f) => f() });
  return { synth, sp };
}

describe("Speech", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("say interrupts", () => {
    const { synth, sp } = setup();
    sp.say("Wall on your left.");
    sp.say("Turn right.");
    const c = synth.calls as string[];
    expect(c.filter(x => x === "speak").length).toBe(2);
    expect(c.slice(c.indexOf("speak") + 1, c.lastIndexOf("speak"))).toContain("cancel");
  });

  it("speech priority", () => {
    const { synth, sp } = setup();
    sp.say("Walk about 12 steps.", 2);
    const n = synth.calls.length;
    sp.say("Possibly a sign.", 1);
    expect(synth.calls.length).toBe(n); // dropped: no cancel, no speak
    sp.say("Stairs ahead.", 3);
    expect(synth.calls.slice(n)).toEqual(["cancel", "speak"]);
  });

  it("lower priority speaks once the current line ended", () => {
    const { synth, sp } = setup();
    sp.say("Walk.", 2);
    synth.spoken[0].onend?.({});
    sp.say("Possibly a sign.", 1);
    expect(synth.spoken.length).toBe(2);
  });

  it("speech splits long text", () => {
    const { synth, sp } = setup();
    const s = (w: string) => (w + " ").repeat(Math.floor(98 / (w.length + 1))).trim() + ".";
    const text = [s("alpha"), s("bravo"), s("charlie"), s("delta")].join(" ").padEnd(400, " ");
    expect(text.length).toBeGreaterThanOrEqual(395);
    sp.say(text);
    expect(synth.spoken.length).toBeGreaterThanOrEqual(3);
    for (const u of synth.spoken) expect(u.text.length).toBeLessThanOrEqual(160);
    expect(sp.live.length).toBe(synth.spoken.length); // references kept
  });

  it("splits a single sentence longer than 160 at word boundaries", () => {
    const { synth, sp } = setup();
    sp.say(("word ".repeat(70)).trim());
    for (const u of synth.spoken) expect(u.text.length).toBeLessThanOrEqual(160);
    expect(synth.spoken.length).toBeGreaterThanOrEqual(3);
  });

  it("screen reader mode does not speak", () => {
    const { synth, sp } = setup();
    sp.setOutput("app");
    expect(document.getElementById("say-polite")!.getAttribute("aria-live")).toBe("off");
    sp.setOutput("screenreader");
    sp.say("x");
    expect(document.getElementById("say-polite")!.textContent).toBe("x");
    expect(document.getElementById("say-polite")!.getAttribute("aria-live")).toBe("polite");
    expect(document.getElementById("say-assertive")!.getAttribute("aria-live")).toBe("assertive");
    sp.say("Stairs ahead.", 3);
    expect(document.getElementById("say-assertive")!.textContent).toBe("Stairs ahead.");
    sp.prime("Starting.");
    expect(synth.calls).not.toContain("speak");
  });

  it("app mode mirrors text to the transcript", () => {
    const { sp } = setup();
    sp.setOutput("app");
    sp.say("Turn left.");
    expect(document.getElementById("say-polite")!.textContent).toBe("Turn left.");
    sp.say("Turn left.");
    expect(document.getElementById("say-polite")!.textContent).toBe("Turn left.");
  });

  it("voice prefers local", () => {
    const google = { name: "Google US English", lang: "en-US", localService: false, default: true };
    const local = { name: "Samantha", lang: "en-US", localService: true, default: false };
    const { synth, sp } = setup([google, local]);
    synth.fire("voiceschanged");
    expect(sp.voice).toBe(local);
    sp.say("Hello.");
    expect(synth.spoken[0].voice).toBe(local);
  });

  it("treats canceled and interrupted as normal and resumes a paused synth", () => {
    const { synth, sp } = setup();
    synth.paused = true;
    sp.say("One.");
    expect(synth.calls).toContain("resume");
    expect(() => synth.spoken[0].onerror?.({ error: "interrupted" })).not.toThrow();
    expect(sp.errors).toEqual([]);
    synth.spoken[0].onerror?.({ error: "synthesis-failed" });
    expect(sp.errors).toEqual(["synthesis-failed"]);
  });

  it("ducks while speaking and calls rate", () => {
    const { synth, sp } = setup();
    const duck: boolean[] = [];
    sp.onDuck = (on) => duck.push(on);
    sp.setRate(1.3);
    sp.say("One.");
    synth.spoken[0].onstart?.({});
    synth.spoken[0].onend?.({});
    expect(duck).toEqual([true, false]);
    expect(synth.spoken[0].rate).toBeCloseTo(1.3);
  });
});
