// @vitest-environment jsdom
// The beacon is accurate enough to navigate by: true bearing, on axis cue, front/back, rate by distance, smooth turning,
// and a 60 fps update path that needs no key press.
import { describe, expect, it } from "vitest";
import { fakeCounts, FakeAudioContext, gridPkg } from "../test/fakes";
import type { Vec2 } from "../types";
import { World } from "../world";
import { AudioEngine } from "./engine";
import { Speech } from "./speech";
import { azimuth, forwardFor } from "./space";
import { BEHIND_LEVEL, BEHIND_LP_HZ, BEHIND_RATE, CLICK_HZ, CLICK_S, cueOf, heard, humParams, wobbleRate } from "./beacon_cue";
import { BEACON_GAIN, beaconAz, beaconSpot, ContinuousSounds, GLIDE_S } from "./continuous";
import { toAudio } from "./space";
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
  it("aim = brightness: >20 off a ~1.2 kHz low-pass and full wobble; 20 to 5 sweeps to ~6 kHz and ~15%; within 5 the brightest, nearly steady, a click", () => {
    const off = humParams(30, 8), near = humParams(-10, 8), on = humParams(2, 8), edge = humParams(5.01, 8);
    expect(off.lpHz).toBeCloseTo(1200, 0); expect(off.depth).toBeCloseTo(0.5, 6); expect(off.click).toBe(false);
    expect(near.lpHz).toBeGreaterThan(off.lpHz); expect(near.lpHz).toBeLessThan(6000);
    expect(near.depth).toBeLessThan(0.5); expect(near.depth).toBeGreaterThan(0.15); expect(near.click).toBe(false);
    expect(edge.lpHz).toBeCloseTo(6000, -2); expect(edge.depth).toBeCloseTo(0.15, 2);
    expect(on.lpHz).toBeGreaterThanOrEqual(6000); expect(on.depth).toBeLessThan(0.1); expect(on.click).toBe(true);
    expect(humParams(20, 8).lpHz).toBeCloseTo(1200, 0);   // continuous at the band edge
    let last = 0;   // brighter monotonically as the aim closes in
    for (let a = 90; a >= 0; a -= 0.5) { const q = humParams(a, 8); expect(q.lpHz).toBeGreaterThanOrEqual(last - 1e-9); last = q.lpHz; }
    for (const a of [30, -10, 2]) expect(humParams(a, 8).level).toBe(1);   // level ~constant
  });
  it("behind: a ~1 kHz low-pass, ~4 dB down, the wobble 25% slower; never in front", () => {
    const back = humParams(150, 5), side = humParams(85, 5);
    expect(back.lpHz).toBe(BEHIND_LP_HZ); expect(BEHIND_LP_HZ).toBe(1000);
    expect(20 * Math.log10(back.level)).toBeCloseTo(-4, 6); expect(back.level).toBe(BEHIND_LEVEL);
    expect(back.rateHz).toBeCloseTo(3 * BEHIND_RATE, 6); expect(BEHIND_RATE).toBe(0.75);
    expect(side.lpHz).toBeCloseTo(1200, 0); expect(side.level).toBe(1); expect(side.rateHz).toBeCloseTo(3, 6);
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
  it("the wobble: about 1.5/s at 12 m, 3/s at 5 m, 6/s at 1.5 m, smooth and monotone between, depth ~50% off axis", () => {
    expect(wobbleRate(12)).toBeCloseTo(1.5); expect(wobbleRate(5)).toBeCloseTo(3); expect(wobbleRate(1.5)).toBeCloseTo(6);
    for (const [d, r] of [[12, 1.5], [5, 3], [1.5, 6]]) { const q = humParams(45, d); expect(q.rateHz).toBeCloseTo(r, 6); expect(q.depth).toBeCloseTo(0.5, 6); }
    let last = 0;
    for (let d = 15; d >= 0; d -= 0.05) { const r = wobbleRate(d); expect(r).toBeGreaterThanOrEqual(last - 1e-9); expect(Math.abs(r - last) < 0.1 || last === 0).toBe(true); last = r; }
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
  it("the hum follows the aim band: on axis, plain, behind", () => {
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
  const hum = (pose: { pos: Vec2; heading: number }, target: () => Vec2 | null, range?: () => number) => {
    const rows = ["####################", ...Array(18).fill("#..................#"), "####################"];
    const w = new World(gridPkg(rows));
    const audio = new AudioEngine(new Speech({ doc: document, raf: f => f() }));
    audio.ctx = new FakeAudioContext() as unknown as AudioContext; (audio as any).build(audio.ctx);
    const c = new ContinuousSounds(audio, w, { pose: () => pose, target, range, live: () => true, raf: () => {} });
    return { c, audio, w };
  };
  it("the hum's nodes get the model's numbers: wobble rate by distance, cutoff and depth by aim, behind darker and quieter", () => {
    const pose = { pos: [10, 10] as Vec2, heading: 0 };
    let range = 12;
    const { c, audio } = hum(pose, () => [10, 13], () => range);
    const at = (r: number, heading: number) => {
      range = r; pose.heading = heading; (audio.ctx as any).currentTime += 1; c.tick();
      const h = (c as any).beacon;
      return { rate: h.lfo.frequency.target, depth: 2 * h.lfoAmt.gain.target, lp: h.lp.frequency.target, level: h.env.gain.target / BEACON_GAIN, tc: h.lfo.frequency.tc };
    };
    const far = at(12, 30), mid = at(5, 30), close = at(1.5, 30);
    expect(far.rate).toBeCloseTo(1.5, 6); expect(mid.rate).toBeCloseTo(3, 6); expect(close.rate).toBeCloseTo(6, 6);
    expect(far.depth).toBeCloseTo(0.5, 6); expect(far.lp).toBeCloseTo(1200, 0); expect(far.level).toBeCloseTo(1, 6);
    expect(far.tc * 3).toBeCloseTo(0.08, 6);   // every parameter ramps over ~80 ms
    const ten = at(5, -10), two = at(5, 2), click = c.lastHum!.click, back = at(5, 180);
    expect(ten.lp).toBeGreaterThan(1200); expect(ten.lp).toBeLessThan(6000); expect(ten.depth).toBeLessThan(0.5); expect(ten.depth).toBeGreaterThan(0.15);
    expect(two.lp).toBeGreaterThanOrEqual(6000); expect(two.depth).toBeLessThan(0.1); expect(click).toBe(true);
    expect(back.lp).toBeCloseTo(1000, 0); expect(20 * Math.log10(back.level)).toBeCloseTo(-4, 6); expect(back.rate).toBeCloseTo(3 * 0.75, 6);
  });
  it("one voice, created once: walking, turning, a new corner and a silent stretch never start a source again", () => {
    const pose = { pos: [7, 7] as Vec2, heading: 0 };   // kept over 3 m from every wall: no obstacle tick voice
    let aim: Vec2 | null = [7, 15];
    const { c, audio } = hum(pose, () => aim);
    const s0 = fakeCounts.starts;
    c.tick();
    const made = fakeCounts.starts - s0;
    expect(made).toBeGreaterThanOrEqual(7);   // five partials, the noise, the wobble, the click
    const h = (c as any).beacon;
    for (let i = 0; i < 600; i++) {
      (audio.ctx as any).currentTime = i / 60;
      pose.pos = [7 + (i % 300) * 0.01, 7 + i * 0.008]; pose.heading = (i * 3) % 360;
      if (i === 200) aim = [15, 15];             // the next corner
      if (i === 300) aim = null;                 // reached a pause: silent, still alive
      if (i === 360) aim = [7, 15];
      c.tick();
      expect((c as any).beacon).toBe(h);
    }
    expect(fakeCounts.starts - s0).toBe(made);
    expect(c.beaconRunning).toBe(true);
    expect(h.env.gain.target).toBeGreaterThan(0);
  });
  it("a new corner glides the source over ~250 ms; the panner aims at the corner's bearing", () => {
    const pose = { pos: [5, 5] as Vec2, heading: 40 };
    let aim: Vec2 = [5, 15];
    const { c, audio } = hum(pose, () => aim);
    c.tick();
    const h = (c as any).beacon;
    const pan = () => [h.panner.positionX.target, h.panner.positionY.target, h.panner.positionZ.target];
    expect(pan()).toEqual(toAudio(beaconSpot(pose.pos, aim)));
    expect(Math.abs(azimuth(pose.pos, pose.heading, c.lastSpot!) - beaconAz(pose.pos, pose.heading, aim))).toBeLessThan(1);
    expect(h.panner.positionX.tc).toBeCloseTo(0.02, 6);
    aim = [15, 5]; (audio.ctx as any).currentTime = 1; c.tick();
    expect(h.panner.positionX.tc * 3).toBeCloseTo(GLIDE_S, 6);   // glides, does not jump
    expect(pan()).toEqual(toAudio(beaconSpot(pose.pos, aim)));
    (audio.ctx as any).currentTime = 1 + GLIDE_S + 0.01; c.tick();
    expect(h.panner.positionX.tc).toBeCloseTo(0.02, 6);            // then tracks the walker closely again
  });
});
