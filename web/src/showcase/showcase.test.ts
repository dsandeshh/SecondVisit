// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fixturePkg } from "../test/fakes";
import { World } from "../world";
import { fitCalibration, headingToYaw, planToSdk, sdkToPlan, yawToHeading } from "./calibrate";
import { chooseSweep, chooseSweepAhead, moveStyle, SweepFollower, type PlanSweep } from "./follow";
import { FALLBACK_LINE, SDK_TIMEOUT_MS, waitPlaying, withTimeout } from "./load";

const panos = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, x: Math.cos(i * 1.7) * 9 + i * 0.8, y: Math.sin(i * 2.3) * 5 - i * 0.3 }));

function synth(rotDeg: number, tx: number, ty: number, mirror: boolean, noise = 0) {
  // build SDK points so that sdkToPlan(truth) maps them onto panos
  const a = -rotDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return panos.map((p, i) => {
    const dx = p.x - tx, dy = p.y - ty;
    let ux = c * dx - s * dy; const uy = s * dx + c * dy;
    if (mirror) ux = -ux;
    return { id: `p${i}`, x: ux + noise * Math.sin(i * 12.9), z: -uy + noise * Math.cos(i * 7.7) };
  });
}

describe("calibration", () => {
  it("recovers known rotation + translation under 10 cm", () => {
    const c = fitCalibration(synth(37, 12.5, -4.2, false, 0.03), panos)!;
    expect(c.mirrored).toBe(false);
    expect(c.meanErr).toBeLessThan(0.1);
    expect(Math.abs(c.rotDeg - 37)).toBeLessThan(2);
    expect(c.method).toBe("ids");
  });
  it("detects a mirrored frame", () => {
    const c = fitCalibration(synth(-110, 3, 8, true), panos)!;
    expect(c.mirrored).toBe(true);
    expect(c.meanErr).toBeLessThan(0.1);
  });
  it("falls back to nearest neighbours when ids differ", () => {
    const pts = synth(80, -5, 2, false, 0.02).map((p, i) => ({ ...p, id: `other${i}` }));
    const c = fitCalibration(pts, panos)!;
    expect(c.method).toBe("nearest");
    expect(c.meanErr).toBeLessThan(0.1);
  });
  it("round trips plan <-> sdk and heading <-> yaw", () => {
    const c = fitCalibration(synth(37, 12.5, -4.2, false), panos)!;
    const s = planToSdk(c, [3, -2]);
    const p = sdkToPlan(c, s.x, s.z);
    expect(Math.hypot(p[0] - 3, p[1] + 2)).toBeLessThan(1e-6);
    expect(Math.abs(yawToHeading(c, headingToYaw(c, 123)) - 123)).toBeLessThan(1e-6);
  });
});

describe("sweep chooser", () => {
  const world = new World(fixturePkg());
  // pillar at (10, 6): a sweep right behind it is nearer but not visible
  const pos: [number, number] = [8, 6];
  const sweeps: PlanSweep[] = [
    { id: "behind", plan: [11.2, 6], enabled: true },
    { id: "clear", plan: [8, 9.4], enabled: true },
    { id: "off", plan: [8.5, 6], enabled: false },
  ];
  it("line of sight blocks a nearer sweep, disabled sweeps skipped", () => {
    expect(chooseSweep(world, sweeps, pos, null)).toBe("clear");
  });
  it("queues at most one move while one is in flight; the newest pose wins", async () => {
    const releases: (() => void)[] = [];
    const ids: string[] = [];
    const move = vi.fn((id: string) => { ids.push(id); return new Promise<void>(r => { releases.push(r); }); });
    const line: PlanSweep[] = [
      { id: "A", plan: [8, 7.5], enabled: true }, { id: "B", plan: [8, 8.5], enabled: true }, { id: "C", plan: [8, 9.3], enabled: true },
    ];
    const f = new SweepFollower(world, () => line, move);
    const first = f.update([8, 6.8], 0);
    expect(await f.update([8, 7.6], 0)).toBe(false); // queued (would be B)
    expect(await f.update([8, 8.7], 0)).toBe(false); // replaces it (C): depth 1, newest wins
    expect(move).toHaveBeenCalledTimes(1);
    releases[0]();
    await vi.waitFor(() => expect(move).toHaveBeenCalledTimes(2)); // chained straight on, no dropped press
    releases[1](); await first;
    expect(ids).toEqual(["A", "C"]);
    expect(f.current).toBe("C");
    expect(f.queued).toBe(2);
    expect(await f.update([8, 8.7], 0)).toBe(false); // same sweep: no move
  });
  it("tells the mover the jump length and whether it is the first placement", async () => {
    const info: { jumpM: number; first: boolean }[] = [];
    const line: PlanSweep[] = [{ id: "A", plan: [8, 7.5], enabled: true }, { id: "B", plan: [8, 8.5], enabled: true }];
    const f = new SweepFollower(world, () => line, async (_id, _h, i) => { info.push(i); });
    await f.update([8, 6.8], 0); await f.update([8, 8.0], 0);
    expect(info[0].first).toBe(true);
    expect(info[1].first).toBe(false);
    expect(info[1].jumpM).toBeCloseTo(1.0, 5);
  });
});

describe("sweep ahead", () => {
  const world = new World(fixturePkg());
  it("prefers the sweep ahead over a nearer one behind or to the side", () => {
    const s: PlanSweep[] = [
      { id: "behind", plan: [8, 6.6], enabled: true }, { id: "side", plan: [9.2, 7], enabled: true }, { id: "ahead", plan: [8, 8.8], enabled: true },
    ];
    expect(chooseSweepAhead(world, s, [8, 7], 0, null)).toBe("ahead");
    expect(chooseSweep(world, s, [8, 7], null)).toBe("behind"); // the old chooser took the nearest
  });
  it("ignores sweeps outside 60 degrees or beyond 2.5 m; then falls back to the nearest", () => {
    const s: PlanSweep[] = [
      { id: "behind", plan: [8, 6.6], enabled: true }, { id: "far", plan: [8, 9.7], enabled: true }, { id: "wide", plan: [9.5, 7.6], enabled: true },
    ];
    expect(chooseSweepAhead(world, s, [8, 7], 0, null)).toBe("behind");
  });
  it("needs a clear line of sight", () => {
    // pillar at (10, 6): heading east from (9, 6), the sweep at (11, 6) is hidden
    const s: PlanSweep[] = [{ id: "hidden", plan: [11, 6], enabled: true }, { id: "near", plan: [8.8, 6.2], enabled: true }];
    expect(chooseSweepAhead(world, s, [9, 6], 90, null)).toBe("near");
  });
  it("keeps the current sweep while it is still a step ahead, then moves on", () => {
    const s: PlanSweep[] = [
      { id: "cur", plan: [8, 8.8], enabled: true }, { id: "mid", plan: [8, 8.0], enabled: true }, { id: "next", plan: [8, 9.4], enabled: true },
    ];
    expect(chooseSweepAhead(world, s, [8, 7], 0, "cur")).toBe("cur");
    expect(chooseSweepAhead(world, s, [8, 8.3], 0, "cur")).toBe("next");
  });
  it("move style: short steps glide in 400 ms; long jumps and the entrance fly", () => {
    expect(moveStyle(1.2, false)).toEqual({ long: false, ms: 400 });
    expect(moveStyle(4.5, false).long).toBe(true);
    expect(moveStyle(0.5, true).long).toBe(true);
  });
});

describe("fallback", () => {
  it("SDK never ready rejects within the timeout", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 8000, "Showcase SDK not ready in 8 s");
    const out = p.then(() => "ok", e => (e as Error).message);
    await vi.advanceTimersByTimeAsync(8001);
    expect(await out).toMatch(/not ready/);
    vi.useRealTimers();
  });
  it("fallback line is the agreed copy", () => expect(FALLBACK_LINE).toBe("Photo view needs internet; showing the scan."));
});

describe("mountShowcase failure", () => {
  it("offline: onFail once with the calm line, resolves an inert handle, never rejects", async () => {
    const { mountShowcase } = await import("./index");
    const { CueBus } = await import("../events");
    const pkg = fixturePkg(); const say = vi.fn(), onFail = vi.fn();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const h = await mountShowcase({ host: document.createElement("div"), pkg, world: new World(pkg), bus: new CueBus(), say, onFail, sdkKey: "k" });
    expect(h.ready).toBe(false);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(FALLBACK_LINE);
    expect(() => h.setPose([1, 1], 0)).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe("phase wait", () => {
  it("timeout is 20 s", () => expect(SDK_TIMEOUT_MS).toBe(20000));
  it("waitPlaying resolves only once the phase is PLAYING", async () => {
    const Phase = { LOADING: "l", PLAYING: "p" };
    let cond!: (s: { phase: string }) => boolean; let done = false;
    const sdk = { App: { Phase, state: { waitUntil: (c: typeof cond) => new Promise<void>(r => { cond = c; setTimeout(() => r(), 0); }) } } };
    const p = waitPlaying(sdk).then(() => { done = true; });
    expect(cond({ phase: "l" })).toBe(false);
    expect(cond({ phase: "p" })).toBe(true);
    await p; expect(done).toBe(true);
  });
});
