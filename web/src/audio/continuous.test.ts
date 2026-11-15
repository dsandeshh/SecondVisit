// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { gridPkg } from "../test/fakes";
import type { Vec2 } from "../types";
import { World } from "../world";
import { azimuth } from "./space";
import { AudioEngine } from "./engine";
import { Speech } from "./speech";
import { FakeAudioContext } from "../test/fakes";
import { beaconAz, beaconRate, beaconSpot, ContinuousSounds, nearestAhead, proxGain, throbDepth, BEACON_GAIN, PROX_GAIN, DRONE_HZ } from "./continuous";
import { BUS_DUCK, BUS_LEVEL } from "./engine";

describe("continuous beacon", () => {
  it("pulses about 1/s beyond 10 m, 2/s at 5 m, 4/s within 2 m, interpolated in between", () => {
    expect(beaconRate(25)).toBe(1); expect(beaconRate(10)).toBe(1); expect(beaconRate(12)).toBe(1);
    expect(beaconRate(5)).toBeCloseTo(2); expect(beaconRate(1.5)).toBe(4);
    expect(beaconRate(2)).toBe(4); expect(beaconRate(0.5)).toBe(4);
    expect(beaconRate(8)).toBeLessThan(beaconRate(4));
  });
  it("the panner angle equals the target's true bearing from the walker's pose", () => {
    const cases: [Vec2, number, Vec2][] = [[[0, 0], 0, [0, 10]], [[0, 0], 0, [10, 0]], [[3, 4], 90, [3, 9]], [[1, 1], 200, [-5, -2]], [[2, 2], 315, [8, 9]]];
    for (const [pos, heading, target] of cases) {
      const spot = beaconSpot(pos, target);
      const truth = Math.atan2(target[0] - pos[0], target[1] - pos[1]) * 180 / Math.PI - heading;
      const wrap = (a: number) => ((a + 540) % 360) - 180;
      expect(azimuth(pos, heading, spot)).toBeCloseTo(wrap(truth), 6);
      expect(beaconAz(pos, heading, target)).toBeCloseTo(wrap(truth), 6);
      expect(Math.hypot(spot[0] - pos[0], spot[1] - pos[1])).toBeCloseTo(2, 6);   // a steady level at any range
    }
    expect(beaconAz([0, 0], 0, [10, 0])).toBeCloseTo(90);     // east of a walker facing north: 3 o'clock, right
    expect(beaconAz([0, 0], 90, [0, 10])).toBeCloseTo(-90);   // facing east, the target north is on the left
  });
});

const room = () => new World(gridPkg(["##########", ...Array(8).fill("#........#"), "##########"]));
const engine = () => {
  const audio = new AudioEngine(new Speech({ doc: document, raf: f => f() }));
  audio.ctx = new FakeAudioContext() as unknown as AudioContext; (audio as any).build(audio.ctx);
  return audio;
};

describe("continuous obstacle drone", () => {
  it("is silent beyond 2.5 m and with nothing ahead, rising smoothly to its peak at 0.5 m", () => {
    for (const d of [2.51, 3, 4, 12, Infinity, NaN, null, undefined]) { expect(proxGain(d as number)).toBe(0); expect(throbDepth(d as number)).toBe(0); }
    let last = 0;
    for (let d = 2.5; d >= 0.5 - 1e-9; d -= 0.05) { const g = proxGain(d); expect(g).toBeGreaterThanOrEqual(last); expect(g - last).toBeLessThan(0.05 * PROX_GAIN); last = g; }
    expect(proxGain(2.4)).toBeGreaterThan(0);
    expect(proxGain(0.5)).toBeCloseTo(PROX_GAIN, 9); expect(proxGain(0.2)).toBeCloseTo(PROX_GAIN, 9);
  });
  it("peaks about 6 dB under the beacon", () => {
    expect(20 * Math.log10(PROX_GAIN / BEACON_GAIN)).toBeCloseTo(-6, 1);
  });
  it("throbs only inside 1 m", () => {
    for (const d of [1, 1.2, 2, 2.4]) expect(throbDepth(d)).toBe(0);
    expect(throbDepth(0.9)).toBeGreaterThan(0); expect(throbDepth(0.5)).toBeGreaterThan(throbDepth(0.8));
  });
  it("has no source above 200 Hz: two sines at 80 and 160 Hz under a 300 Hz low-pass", () => {
    const audio = engine(), ctx = audio.ctx as any;
    const oscs: any[] = [], filters: any[] = [];
    const mk = ctx.createOscillator.bind(ctx), mkf = ctx.createBiquadFilter.bind(ctx);
    ctx.createOscillator = () => { const o = mk(); oscs.push(o); return o; };
    ctx.createBiquadFilter = () => { const f = mkf(); filters.push(f); return f; };
    const c = new ContinuousSounds(audio, room(), { pose: () => ({ pos: [5, 7.5], heading: 0 }), target: () => null, live: () => true, raf: () => {} });
    c.tick();
    const d = (c as any).prox;
    expect(d.srcs.map((o: any) => o.frequency.value)).toEqual(DRONE_HZ);
    expect(d.srcs.every((o: any) => o.type === "sine")).toBe(true);
    expect(oscs.filter(o => o.frequency.value !== 4).every(o => o.frequency.value <= 200)).toBe(true);
    expect(oscs.find(o => o.frequency.value === 4)).toBe(d.lfo);
    expect(filters.length).toBeGreaterThanOrEqual(2);
    expect(filters.every(f => f.type === "lowpass" && f.frequency.value <= 300)).toBe(true);
  });
  it("is made and started once over a walk towards a wall, silent far, louder nearer, throbbing only inside 1 m", () => {
    const audio = engine(), ctx = audio.ctx as any;
    const pose = { pos: [5, 1.5] as [number, number], heading: 0 };
    const c = new ContinuousSounds(audio, room(), { pose: () => pose, target: () => null, live: () => true, raf: () => {} });
    let made: any = null, restarts = 0, prev = -1;
    for (let i = 0; pose.pos[1] < 8.6; i++) {
      ctx.currentTime = i / 60; c.tick();
      const p = (c as any).prox;
      if (p && !made) { made = p; for (const n of [...p.srcs, p.lfo]) n.start = () => { restarts++; }; }
      if (made) expect((c as any).prox).toBe(made);
      const q = c.lastProx;
      if (q.d === null || q.d > 2.5) expect(q.level).toBe(0);
      else { expect(q.level).toBeGreaterThanOrEqual(prev - 1e-12); prev = q.level; }
      expect(q.throb > 0).toBe(q.d !== null && q.d < 1);
      pose.pos = [5, pose.pos[1] + 0.05];
    }
    expect(made).not.toBeNull(); expect(restarts).toBe(0); expect(c.droneStarts).toBe(3);
    expect(c.lastProx.level).toBeCloseTo(PROX_GAIN, 6);
  });
});

describe("the mix", () => {
  it("speech ducks the cue bus (beacon and drone) about 12 dB, over ~80 ms", () => {
    const audio = engine(), b = audio.buses as any;
    let got: number[] = [];
    b.cue.gain.setTargetAtTime = (v: number, _t: number, tau: number) => { got = [v, tau]; return b.cue.gain; };
    audio.duck(true);
    expect(20 * Math.log10(got[0] / BUS_LEVEL.cue)).toBeCloseTo(-12, 1); expect(BUS_DUCK.cue).toBeCloseTo(10 ** (-12 / 20));
    expect(got[1] * 3).toBeCloseTo(0.08);
    audio.duck(false); expect(got[0]).toBeCloseTo(BUS_LEVEL.cue);
  });
});

describe("continuous obstacle proximity", () => {
  it("finds the nearest solid thing in the 60 degree cone, with its direction", () => {
    // a 10 x 10 room, walls round it; the walker 2 m from the north wall facing north
    const w = room();
    const n = nearestAhead(w, [5, 7.5], 0)!;
    expect(n.code).toBe(1);
    expect(n.dist).toBeGreaterThan(1.3); expect(n.dist).toBeLessThan(1.6);
    expect(Math.abs(n.az)).toBeLessThanOrEqual(30);
    expect(nearestAhead(w, [5, 2.5], 0)).toBeNull();            // 6.5 m of floor ahead: nothing within 2.5 m
    expect(proxGain(nearestAhead(w, [5, 2.5], 0)?.dist)).toBe(0);
  });
});

describe("continuous sounds in Rehearse", () => {
  it("the obstacle drone still plays, the continuous beacon never does", () => {
    const w = room();
    const audio = engine();
    const c = new ContinuousSounds(audio, w, { pose: () => ({ pos: [5, 7.5], heading: 0 }), target: () => [5, 2], live: () => true, rehearse: () => true });
    for (let i = 0; i < 25; i++) { (audio.ctx as any).currentTime = i * 0.04; c.tick(); }
    expect(c.lastProx.level).toBeGreaterThan(0); expect(c.droneStarts).toBe(3);
    expect(c.pulses).toBe(0);
    expect(c.beaconRunning).toBe(false);
  });
});
