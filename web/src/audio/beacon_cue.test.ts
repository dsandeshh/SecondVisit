// @vitest-environment jsdom
// The beacon is accurate enough to navigate by: true bearing, on axis cue, front/back, rate by distance, smooth turning,
// and a 60 fps update path that needs no key press.
import { describe, expect, it } from "vitest";
import { FakeAudioContext, gridPkg } from "../test/fakes";
import type { Vec2 } from "../types";
import { World } from "../world";
import { AudioEngine } from "./engine";
import { Speech } from "./speech";
import { azimuth, forwardFor } from "./space";
import { BEACON_HZ, BEHIND_LEVEL, BEHIND_LP_HZ, BEHIND_RATE, CLICK_HZ, CLICK_S, cueOf, cueParams, heard, pulseRate } from "./beacon_cue";
import { beaconAz, beaconSpot, ContinuousSounds } from "./continuous";
import { HeadingSmoother, TURN_GLIDE_MS } from "./heading_smooth";

describe("beacon direction", () => {
  it("the panner azimuth equals the true bearing within 1 degree, all round", () => {
    for (let h = 0; h < 360; h += 7) for (let b = 0; b < 360; b += 11) {
      const pos: Vec2 = [3, 4], r = 6.5, tg: Vec2 = [pos[0] + r * Math.sin(b * Math.PI / 180), pos[1] + r * Math.cos(b * Math.PI / 180)];
      const truth = ((b - h + 540) % 360) - 180;
      const d = (x: number) => Math.abs(((x - truth + 540) % 360) - 180);
      expect(d(azimuth(pos, h, beaconSpot(pos, tg)))).toBeLessThan(1);
      expect(d(beaconAz(pos, h, tg))).toBeLessThan(1);
    }
  });
});

describe("beacon cue", () => {
  it("on axis only within 5 degrees, the intermediate form only 5 to 20, plain beyond, behind only beyond 90", () => {
    for (let a = -180; a <= 180; a += 0.5) {
      const c = cueOf(a), m = Math.abs(a);
      expect(c === "on").toBe(m <= 5);
      expect(c === "near").toBe(m > 5 && m <= 20);
      expect(c === "behind").toBe(m > 90);
      expect(c === "plain").toBe(m > 20 && m <= 90);
    }
  });
  it("on axis: a bright click and a raised pitch; near: weaker; plain: neither", () => {
    const on = cueParams(2), near = cueParams(-12), plain = cueParams(45);
    expect(on.click).toBeGreaterThan(near.click); expect(near.click).toBeGreaterThan(0); expect(plain.click).toBe(0);
    expect(on.hz).toBeGreaterThan(near.hz); expect(near.hz).toBeGreaterThan(plain.hz); expect(plain.hz).toBe(BEACON_HZ);
    expect(on.hz / BEACON_HZ).toBeLessThan(1.07);   // slightly raised: one semitone
  });
  it("behind: a 2 kHz low-pass, a small level drop and a slower pulse; never in front", () => {
    const back = cueParams(150), side = cueParams(85);
    expect(back.lpHz).toBe(BEHIND_LP_HZ); expect(back.level).toBe(BEHIND_LEVEL); expect(back.rateK).toBe(BEHIND_RATE);
    expect(BEHIND_LEVEL).toBeGreaterThan(0.5); expect(BEHIND_RATE).toBeLessThan(1);
    expect(side.lpHz).toBeGreaterThan(10000); expect(side.level).toBe(1); expect(side.rateK).toBe(1);
  });
  it("the click stays high and short, far from the low dry obstacle tick (160 Hz square under a 900 Hz low-pass)", () => {
    expect(CLICK_HZ).toBeGreaterThanOrEqual(3000); expect(CLICK_S).toBeLessThanOrEqual(0.01);
    expect(CLICK_HZ / 900).toBeGreaterThan(3);
  });
  it("what the ear hears: cue plus side", () => {
    expect(heard(10)).toEqual({ cue: "near", side: 1 });
    expect(heard(-100)).toEqual({ cue: "behind", side: -1 });
    expect(heard(0)).toEqual({ cue: "on", side: 0 });
  });
});

describe("distance by ear", () => {
  it("about 1/s at 12 m, 2/s at 5 m, 4/s at 1.5 m, smooth and monotone between", () => {
    expect(pulseRate(12)).toBeCloseTo(1); expect(pulseRate(5)).toBeCloseTo(2); expect(pulseRate(1.5)).toBeCloseTo(4);
    let last = 0;
    for (let d = 15; d >= 0; d -= 0.05) { const r = pulseRate(d); expect(r).toBeGreaterThanOrEqual(last - 1e-9); expect(Math.abs(r - last) < 0.1 || last === 0).toBe(true); last = r; }
  });
});

describe("smooth turning", () => {
  it("reaches the stepped heading within 150 ms and never overshoots, across north too", () => {
    for (const [from, step] of [[0, 15], [0, -15], [350, 15], [10, -15], [90, 165]] as [number, number][]) {
      const s = new HeadingSmoother(from);
      s.set(from + step, 1000);
      let prev = 0;
      for (let t = 1000; t <= 1000 + TURN_GLIDE_MS; t += 5) {
        const moved = ((s.at(t) - from + 540) % 360) - 180;   // signed progress
        expect(Math.sign(step) * moved).toBeGreaterThanOrEqual(prev - 1e-9);   // monotone
        expect(Math.abs(moved)).toBeLessThanOrEqual(Math.abs(step) + 1e-9);      // never past the target
        prev = Math.sign(step) * moved;
      }
      expect(s.at(1000 + TURN_GLIDE_MS)).toBeCloseTo(((from + step) % 360 + 360) % 360, 9);
      expect(s.at(5000)).toBeCloseTo(((from + step) % 360 + 360) % 360, 9);
    }
  });
  it("a second press mid glide continues from where the ear is, no jump", () => {
    const s = new HeadingSmoother(0);
    s.set(15, 0); const mid = s.at(60);
    s.set(30, 60);
    expect(s.at(60)).toBeCloseTo(mid, 9);
    expect(s.at(60 + TURN_GLIDE_MS)).toBe(30);
  });
});

describe("the 60 fps update path", () => {
  it("each animation frame moves the listener and the beacon panner without any key press", () => {
    const rows = ["##########", ...Array(8).fill("#........#"), "##########"];
    const w = new World(gridPkg(rows));
    const audio = new AudioEngine(new Speech({ doc: document, raf: f => f() }));
    audio.ctx = new FakeAudioContext() as unknown as AudioContext; (audio as any).build(audio.ctx);
    const frames: (() => void)[] = [];
    let now = 0;
    const turn = new HeadingSmoother(0);
    const pose = { pos: [5, 5] as Vec2, heading: 0 };
    const c = new ContinuousSounds(audio, w, {
      pose: () => pose, ear: () => ({ pos: pose.pos, heading: turn.at(now) }),
      target: () => [8, 5], live: () => true, raf: f => { frames.push(f); },
    });
    c.start();
    const run = () => { const f = frames.shift()!; f(); };
    run();
    const v = (c as any).beacon;
    const xs: number[] = [];
    v.panner.positionX.setTargetAtTime = (x: number) => { xs.push(x); return v.panner.positionX; };
    pose.heading = 15; turn.set(15, now);        // one turn press, then only frames
    const fwd: number[] = [];
    for (let i = 0; i < 12; i++) { now += 16; (audio.ctx as any).currentTime = now / 1000; run(); fwd.push(audio.ctx!.listener.forwardX.value); }
    expect(new Set(fwd.map(f => f.toFixed(4))).size).toBeGreaterThan(5);          // the ear swept, frame by frame
    expect(fwd.at(-1)!).toBeCloseTo(forwardFor(15)[0], 6);                         // and arrived on the stepped heading
    expect(c.frames).toBe(13);
    pose.pos = [5.5, 5];                          // walking moves the panner on the next frame (no tick, no key)
    run();
    expect(xs.at(-1)).not.toBe(xs[0]);
    c.stop();
  });
  it("the pulse shape follows the cue: on axis pulses get the click, off axis ones do not", () => {
    const rows = ["##########", ...Array(8).fill("#........#"), "##########"];
    const w = new World(gridPkg(rows));
    const audio = new AudioEngine(new Speech({ doc: document, raf: f => f() }));
    audio.ctx = new FakeAudioContext() as unknown as AudioContext; (audio as any).build(audio.ctx);
    const pose = { pos: [5, 5] as Vec2, heading: 90 };
    const c = new ContinuousSounds(audio, w, { pose: () => pose, target: () => [8, 5], live: () => true, raf: () => {} });
    c.tick(); expect(c.lastCue).toBe("on");
    pose.heading = 0; (audio.ctx as any).currentTime = 2; c.tick(); expect(c.lastCue).toBe("plain");
    pose.heading = 270; (audio.ctx as any).currentTime = 4; c.tick(); expect(c.lastCue).toBe("behind");
  });
});
