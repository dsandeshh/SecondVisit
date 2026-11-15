// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudioContext, fakeSynth, FakeUtterance } from "../test/fakes";
import { AudioEngine } from "./engine";
import { pulse } from "./haptics";
import { Speech } from "./speech";

const nav = navigator as any;

function engine() {
  document.body.innerHTML = `<p id="say-polite"></p><p id="say-assertive"></p>`;
  const synth = fakeSynth();
  const speech = new Speech({ synth, Utterance: FakeUtterance as any, raf: (f) => f() });
  return { e: new AudioEngine(speech), synth };
}

describe("AudioEngine.start", () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete nav.audioSession;
    delete (window as any).DeviceOrientationEvent;
  });

  it("ctx is null before start", () => {
    expect(engine().e.ctx).toBeNull();
  });

  it("audioSession set", async () => {
    const order: string[] = [];
    nav.audioSession = { set type(v: string) { order.push("session:" + v); } };
    vi.stubGlobal("AudioContext", class extends FakeAudioContext {
      constructor() { order.push("context"); super(); }
    });
    const { e } = engine();
    vi.useFakeTimers();
    const p = e.start("app");
    await vi.advanceTimersByTimeAsync(1100);
    const r = await p;
    expect(order).toEqual(["session:playback", "context"]);
    expect(r.audio).toBe("running");
  });

  it("speaks the prime line inside the gesture in app mode only", async () => {
    const a = engine();
    vi.useFakeTimers();
    const p = a.e.start("app");
    expect(a.synth.calls).toContain("speak"); // before the first await resolves
    await vi.advanceTimersByTimeAsync(1100); await p;
    const b = engine();
    const q = b.e.start("screenreader");
    await vi.advanceTimersByTimeAsync(1100); await q;
    expect(b.synth.calls).not.toContain("speak");
  });

  it("motion unavailable on desktop", async () => {
    (window as any).DeviceOrientationEvent = class {};
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    const { e } = engine();
    vi.useFakeTimers();
    const p = e.start("app");
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.motion).toBe("unavailable");
    expect(e.mode).toBe("keys");
    expect(r.latencyMs).toBe(30);
  });

  it("motion granted when a real orientation event arrives", async () => {
    (window as any).DeviceOrientationEvent = class {};
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    const { e } = engine();
    vi.useFakeTimers();
    const p = e.start("app");
    await vi.advanceTimersByTimeAsync(100);
    const ev: any = new Event("deviceorientation"); ev.alpha = 10; ev.beta = 0; ev.gamma = 0;
    window.dispatchEvent(ev);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).motion).toBe("granted");
    expect(e.mode).toBe("motion");
  });

  it("orientation denied falls back", async () => {
    let calledSync = false;
    (window as any).DeviceOrientationEvent = { requestPermission: () => { calledSync = true; return Promise.reject(new Error("no")); } };
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    const { e } = engine();
    vi.useFakeTimers();
    const p = e.start("app");
    expect(calledSync).toBe(true); // asked inside the click, before any await
    await vi.advanceTimersByTimeAsync(1100);
    const r = await p;
    expect(r.motion).toBe("denied");
    expect(e.mode).toBe("touch");
    expect(e.statusLine(r)).toContain("Motion not available. Use the Step button and the arrow buttons.");
  });

  it("announces when audio is interrupted and resumes on the next gesture", async () => {
    const { e, synth } = engine();
    vi.useFakeTimers();
    const p = e.start("app");
    await vi.advanceTimersByTimeAsync(1100); await p;
    const ctx = e.ctx as unknown as FakeAudioContext;
    ctx.state = "interrupted";
    ctx.onstatechange?.();
    expect(synth.spoken.at(-1)!.text).toMatch(/Sound paused/);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(ctx.state).toBe("running");
  });
});

describe("haptics", () => {
  it("vibrate guarded", () => {
    const had = "vibrate" in nav;
    const old = nav.vibrate;
    Object.defineProperty(nav, "vibrate", { value: undefined, configurable: true, writable: true });
    expect(() => pulse(25)).not.toThrow();
    const v = vi.fn();
    nav.vibrate = v;
    pulse(10);
    expect(v).toHaveBeenCalledWith(25);
    if (had) nav.vibrate = old; else delete nav.vibrate;
  });
});

describe("AudioEngine.hold (P)", () => {
  it("suspends the context so a clip stops mid line, and resumes it from the same point, without the paused alarm", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const { e } = engine();
    await e.start("app", 0);
    const c = e.ctx as any;
    const alarms = vi.fn(); e.onPause = alarms;
    e.hold(true);
    expect(c.state).toBe("suspended");
    c.onstatechange?.();                 // the browser reports the state change
    expect(alarms).not.toHaveBeenCalled();
    e.hold(false);
    expect(c.state).toBe("running");
    vi.unstubAllGlobals();
  });
});
