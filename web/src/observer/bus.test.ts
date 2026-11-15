import { describe, expect, it, vi } from "vitest";
import { openBus } from "./bus";
import type { ObsMsg } from "./protocol";

const say = (text: string): ObsMsg => ({ v: 1, t: "say", ts: 1, text, pri: 1 });
const pose = (ts: number): ObsMsg => ({ v: 1, t: "pose", ts, pos: [1, 1], heading: 0, cane_deg: 0 });
const tick = () => new Promise((r) => setTimeout(r, 30));

describe("bus", () => {
  it("roundtrip: same session receives, other session does not", async () => {
    const a = openBus("s1"), b = openBus("s1"), c = openBus("s2");
    const gotB: ObsMsg[] = [], gotC: ObsMsg[] = [];
    b.subscribe((m) => gotB.push(m)); c.subscribe((m) => gotC.push(m));
    a.publish(say("hi"));
    await tick();
    expect(gotB).toEqual([say("hi")]);
    expect(gotC).toEqual([]);
    a.close(); b.close(); c.close();
  });

  it("pose throttle: 100 poses in 1 s deliver at most 16", async () => {
    const a = openBus("s3"), b = openBus("s3");
    let n = 0; b.subscribe(() => n++);
    for (let i = 0; i < 100; i++) a.publish(pose(i));
    await tick();
    expect(n).toBeLessThanOrEqual(16);
    expect(n).toBeGreaterThanOrEqual(1);
    a.close(); b.close();
  });

  it("without transports publish does not throw", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const a = openBus("s4");
    expect(() => { a.publish(say("x")); a.close(); }).not.toThrow();
    vi.unstubAllGlobals();
  });
});
