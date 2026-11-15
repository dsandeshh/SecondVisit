import { describe, expect, it, vi } from "vitest";
import { fixturePkg } from "../test/fakes";
import { World } from "../world";
import { fitCalibration, headingToYaw, planToSdk, sdkToPlan, yawToHeading } from "./calibrate";
import { chooseSweep, SweepFollower, type PlanSweep } from "./follow";
import { FALLBACK_LINE, withTimeout } from "./load";

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
  it("never queues a second move while one is in flight", async () => {
    let release!: () => void;
    const move = vi.fn(() => new Promise<void>(r => { release = r; }));
    const f = new SweepFollower(world, () => sweeps, move);
    const first = f.update(pos, 0);
    const second = await f.update([8, 6.2], 0);
    expect(second).toBe(false);
    expect(move).toHaveBeenCalledTimes(1);
    release(); await first;
    expect(f.current).toBe("clear");
    expect(await f.update(pos, 0)).toBe(false); // same sweep: no move
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
