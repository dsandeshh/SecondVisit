// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fullFlow, runFlow, type OutdoorOpts } from "./flow";
import { fixturePkg } from "./test/fakes";
import { CueBus } from "./events";

const base = () => ({ pkg: fixturePkg(), stage: document.createElement("div"), say: vi.fn(), bus: new CueBus() });

describe("full flow", () => {
  it("passes the audio engine to the hook", async () => {
    const audio = { id: "engine" }; let got: unknown;
    await runFlow({ ...base(), audio, begin: () => {}, hook: { startOutdoor: o => { got = (o as any).audio; } } });
    expect(got).toBe(audio);
  });
  it("is off unless ?flow=full", () => {
    expect(fullFlow(new URLSearchParams(""))).toBe(true);   // the journey starts outside by default
    expect(fullFlow(new URLSearchParams("flow=interior"))).toBe(false);
    expect(fullFlow(new URLSearchParams("flow=full"))).toBe(true);
  });
  it("with no hook the interior starts at once", async () => {
    const begin = vi.fn();
    expect(await runFlow({ ...base(), hook: null, begin })).toBe("interior");
    expect(begin).toHaveBeenCalledTimes(1);
  });
  it("with a hook the interior waits for onInside, and starts once", async () => {
    const begin = vi.fn(), on = vi.fn();
    let cb!: () => void; let opts!: OutdoorOpts;
    const r = await runFlow({ ...base(), onOutdoor: on, begin, hook: { startOutdoor: o => { opts = o; cb = o.onInside; } } });
    expect(r).toBe("outdoor");
    expect(begin).not.toHaveBeenCalled();
    expect(opts.pkg.entrances[0]).toBeDefined();
    cb(); cb();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(on.mock.calls.map(c => c[0])).toEqual([true, false]);
  });
  it("a hook that returns a handle with onInside also works", async () => {
    const begin = vi.fn(); const handle: any = { onInside: null };
    await runFlow({ ...base(), begin, hook: { startOutdoor: () => handle } });
    handle.onInside();
    expect(begin).toHaveBeenCalledTimes(1);
  });
  it("a hook that throws falls back to the interior", async () => {
    const begin = vi.fn();
    expect(await runFlow({ ...base(), begin, hook: { startOutdoor: () => { throw new Error("x"); } } })).toBe("interior");
    expect(begin).toHaveBeenCalledTimes(1);
  });
});
