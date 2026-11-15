import { describe, expect, it, vi } from "vitest";
import { fixturePkg } from "../test/fakes";
import { angularError, bearing, PointTask, pointFeedback } from "./point";

describe("pointing", () => {
  it("angularError wraps", () => {
    expect(angularError(350, 10)).toBeCloseTo(20);
    expect(angularError(0, 180)).toBeCloseTo(180);
    expect(angularError(10, 350)).toBeCloseTo(20);
  });
  it("bearing east is 90", () => {
    expect(bearing([0, 0], [5, 0])).toBeCloseTo(90);
    expect(bearing([0, 0], [0, -5])).toBeCloseTo(180);
    expect(bearing([0, 0], [-5, 0])).toBeCloseTo(270);
  });
  it("point task error", () => {
    const pkg = fixturePkg();
    const e = pkg.entrances[0], desk = pkg.landmarks[0];
    const t = new PointTask(e.pos, e.heading_deg, desk);
    t.turn(bearing(e.pos, desk.pos) - e.heading_deg);
    const r = t.confirm(4000);
    expect(r.error_deg).toBeLessThan(3);
    expect(r.target).toBe("desk");
    expect(r.time_s).toBeCloseTo(4);
    expect(r.target_bearing).toBeCloseTo(bearing(e.pos, desk.pos));
  });
  it("error is large when pointing away", () => {
    const pkg = fixturePkg();
    const t = new PointTask(pkg.entrances[0].pos, 90, pkg.landmarks[0]);
    t.turn(180);
    expect(t.confirm(1000).error_deg).toBeGreaterThan(150);
  });
  it("no feedback before confirm", () => {
    const pkg = fixturePkg();
    const say = vi.fn();
    const t = new PointTask(pkg.entrances[0].pos, 90, pkg.landmarks[0]);
    t.start(say);
    t.turn(5); t.turn(5);
    expect(say.mock.calls.some(c => /degrees/.test(c[0]))).toBe(false);
    expect(say.mock.calls[0][0]).toMatch(/You are back at the entrance, facing into the building\. Turn to face the reception desk, then press Space\./);
  });
  it("ratchet tick every 15 degrees", () => {
    const pkg = fixturePkg();
    const tick = vi.fn();
    const t = new PointTask(pkg.entrances[0].pos, 90, pkg.landmarks[0], tick);
    t.turn(5); t.turn(5); expect(tick).not.toHaveBeenCalled();
    t.turn(5); expect(tick).toHaveBeenCalledTimes(1);
  });
  it("feedback uses a clock hour and the error", () => {
    const pkg = fixturePkg();
    const t = new PointTask(pkg.entrances[0].pos, 90, pkg.landmarks[0]);
    t.turn(-30);
    const r = t.confirm(1000);
    const line = pointFeedback(r, 90, "reception desk");
    expect(line).toMatch(/You were \d+ degrees off\. The reception desk is at (\d+|12) o'clock from here\./);
  });
});
