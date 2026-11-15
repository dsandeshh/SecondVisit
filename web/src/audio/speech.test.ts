// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { Speech } from "./speech";

function setup() {
  document.body.innerHTML = `<p id="say-polite" aria-live="off"></p><p id="say-assertive" aria-live="off"></p><ol id="say-history"></ol>`;
  return new Speech({ raf: (f) => f() });
}
const el = (id: string) => document.getElementById(id)!;

describe("Speech (captions and priority; the voice is VoiceOut's)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("writes every line to the caption and publishes it on the bus", () => {
    const sp = setup(), seen: string[] = [];
    sp.bus.subscribe(c => { if (c.kind === "say") seen.push(c.text ?? ""); });
    sp.say("Turn left.");
    expect(el("say-polite").textContent).toBe("Turn left.");
    sp.say("Turn left.");
    expect(el("say-polite").textContent).toBe("Turn left.");
    expect(seen).toEqual(["Turn left.", "Turn left."]);
  });

  it("the caption region stays aria-live off", () => {
    const sp = setup();
    sp.say("x"); sp.say("Stairs ahead.", 3);
    expect(el("say-polite").getAttribute("aria-live")).toBe("off");
    expect(el("say-assertive").getAttribute("aria-live")).toBe("off");
  });

  it("a lower priority line is dropped while a higher one plays, and speaks after it ended", () => {
    const sp = setup();
    sp.hasClips = true;
    sp.say("Walk about 12 steps.", 2);
    sp.say("Possibly a sign.", 1);
    expect(el("say-polite").textContent).toBe("Walk about 12 steps.");
    sp.say("Stairs ahead.", 3);
    expect(el("say-polite").textContent).toBe("Stairs ahead.");
    sp.stop();
    sp.say("Possibly a sign.", 1);
    expect(el("say-polite").textContent).toBe("Possibly a sign.");
  });

  it("ducks while a clip plays and keeps the rate in range", () => {
    const sp = setup(), duck: boolean[] = [];
    sp.onDuck = on => duck.push(on);
    sp.setRate(3); expect(sp.rate).toBe(1.6);
    sp.setRate(0.1); expect(sp.rate).toBe(0.8);
    sp.hasClips = true;
    sp.say("One.");
    const seq = (sp as any).seq as number;
    sp.clipStarted(seq, 2); sp.clipEnded(seq);
    expect(duck).toEqual([true, false]);
  });

  it("has no browser speech in it", () => {
    expect(Object.keys(setup())).not.toContain("synth");
    expect((setup() as any).speakBrowser).toBeUndefined();
  });
});
