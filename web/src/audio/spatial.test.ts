import { describe, expect, it, vi } from "vitest";
import { FakeAudioContext } from "../test/fakes";
import { toAudio } from "./space";
import { HrtfBudget, ROLLOFF, spatialChain } from "./spatial";

describe("spatialChain", () => {
  it("builds an HRTF inverse distance panner at toAudio(at) with rolloff 0.6", () => {
    const ctx = new FakeAudioContext() as unknown as AudioContext;
    const c = spatialChain(ctx, [3, 4], { pos: [0, 0], heading: 0 });
    const [x, y, z] = toAudio([3, 4]);
    expect([c.panner.positionX.value, c.panner.positionY.value, c.panner.positionZ.value]).toEqual([x, y, z]);
    expect(c.panner.panningModel).toBe("HRTF");
    expect(c.panner.distanceModel).toBe("inverse");
    expect(c.panner.refDistance).toBe(1);
    expect(c.panner.rolloffFactor).toBe(ROLLOFF);
  });
  it("darkens sources behind the listener", () => {
    const ctx = new FakeAudioContext() as unknown as AudioContext;
    const ahead = spatialChain(ctx, [0, 5], { pos: [0, 0], heading: 0 });
    const behind = spatialChain(ctx, [0, -5], { pos: [0, 0], heading: 0 });
    expect((ahead.output as any).frequency.value).toBe(18000);
    expect((behind.output as any).frequency.value).toBe(3500);
  });
});

describe("HRTF budget", () => {
  it("allows two at once and evicts the lowest priority for a higher one", () => {
    const b = new HrtfBudget();
    const stopA = vi.fn(), stopB = vi.fn();
    expect(b.acquire(0, stopA)).not.toBeNull();
    expect(b.acquire(1, stopB)).not.toBeNull();
    expect(b.acquire(0, () => {})).toBeNull();           // full, not higher than anything
    const r = b.acquire(2, () => {});
    expect(r).not.toBeNull();
    expect(stopA).toHaveBeenCalled(); expect(stopB).not.toHaveBeenCalled();
    expect(b.count).toBe(2);
    r!(); expect(b.count).toBe(1);
  });
});
