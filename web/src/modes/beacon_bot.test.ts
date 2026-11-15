// @vitest-environment jsdom
// The three demo legs on the clinic walked by the beacon alone: a bot that hears only the beacon's cue (on axis, near,
// plain, behind, and which ear it leans to, from the same pure function the pulses use; never the target's coordinates)
// turns until on axis (or until a near cue crosses sides, the best a 15 degree turn can do), then steps, and keeps
// stepping while the cue stays on axis or near (aim, then commit); it turns again only on a plain or behind cue. Bumps are met
// as a walker would: the cane finds the opening either side.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ContinuousSounds } from "../audio/continuous";
import { heard, HUM_BEHIND_HZ, HUM_BRIGHT_HZ, HUM_DARK_HZ, type Cue } from "../audio/beacon_cue";
import { AudioEngine } from "../audio/engine";
import { azimuth } from "../audio/space";
import { Speech } from "../audio/speech";
import { FakeAudioContext } from "../test/fakes";
import type { BuildingPackage } from "../types";
import { bearing, dist, wrap180, World } from "../world";
import { Explore } from "./explore";
import { findPath } from "./beacon";
import { TARGET_ARRIVE_M } from "./interact";
import { Session } from "./session";

const CLINIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "buildings", "x37LjPx62VA", "package.json");
const hasClinic = existsSync(CLINIC);
const PRESS_MS = 200;   // the bot waits out the 150 ms glide before listening again

function make(pkg: BuildingPackage) {
  document.body.innerHTML = `<p id="say-polite"></p><p id="say-assertive"></p><ol id="say-history"></ol><div id="stage" tabindex="0"></div><p id="target-line"></p>`;
  const speech = new Speech({ doc: document, raf: f => f() });
  const audio = new AudioEngine(speech);
  audio.ctx = new FakeAudioContext() as unknown as AudioContext; (audio as any).build(audio.ctx);
  const clock = { t: 0 };
  const hooks = { now: () => clock.t };
  const ex = new Explore(new World(pkg), audio, speech, hooks);
  const s = new Session(ex, pkg, speech, hooks, { now: () => clock.t, threadId: "th", publish: () => {}, fetchCoach: async () => null, audioRunning: () => true });
  ex.begin();
  return { s, ex, clock };
}

function byEar(ex: Explore, clock: { t: number }, max = 800): { ups: number; turns: number; silent?: number } {
  let ups = 0, turns = 0, lastTurn = 0, slide = 0, side = 0, committed = false, silent = 0;
  const t = ex.traveller;
  const turn = (deg: number) => { ex.turn(deg); turns += Math.abs(deg) / 15; clock.t += PRESS_MS; };
  const step = (): boolean => { const p = t.pos; ex.step(1); ups++; clock.t += PRESS_MS; return t.pos !== p; };
  for (let i = 0; i < max; i++) {
    const hh = ex.cont.hearing();
    // what the ear can tell: which side, and the brightness band (bright and steady, brightening, dull, dull and muffled)
    const band = (lp: number): Cue => lp >= HUM_BRIGHT_HZ - 1 ? "on" : Math.abs(lp - HUM_BEHIND_HZ) < 1 ? "behind" : lp > HUM_DARK_HZ + 1 ? "near" : "plain";
    const h = hh && { side: hh.side, cue: band(hh.lpHz) };
    if (!h && !ex.fx.beaconTarget) return { ups, turns, silent };   // silent and reached: arrived
    if (!h) { silent++; if (!step()) return { ups: Infinity, turns }; continue; }   // on top of a path corner: walk on
    // aim, then commit: once on axis (or a near cue has crossed sides) keep stepping while it stays on or near
    if (h.cue === "on" || (h.cue === "near" && lastTurn !== 0 && h.side !== lastTurn)) committed = true;
    else if (h.cue !== "near") committed = false;
    if (slide === 0 && !committed && h.side !== 0) { lastTurn = h.side; turn(15 * h.side); continue; }
    if (slide > 0) slide--;
    lastTurn = 0;
    if (step()) continue;
    const order = side ? [side] : [1, -1];
    let moved = false;
    for (let a = 1; a <= 11 && !moved; a++) for (const sd of order) {
      turn(sd * a * 15);
      if (step()) { side = sd; slide = 3; moved = true; break; }
      turn(-sd * a * 15);
    }
    if (!moved) return { ups: Infinity, turns };
  }
  return { ups: Infinity, turns };
}

describe.skipIf(!hasClinic)("the three demo legs by the beacon alone", () => {
  it("entrance -> reception desk -> lab door -> main entrance, by cue only", () => {
    const pkg: BuildingPackage = JSON.parse(readFileSync(CLINIC, "utf8"));
    const { s, ex, clock } = make(pkg);
    const report: string[] = [];
    for (const id of ["dest", "door_3", "ent_main"]) {
      let tabs = 0;
      while (ex.fx.picked !== id && tabs < 60) { s.pick(1); tabs++; }
      s.enter();
      expect(ex.fx.beaconTarget?.id).toBe(id);
      const r = byEar(ex, clock);
      expect(r.ups, `leg to ${id}`).toBeLessThan(Infinity);
      expect(dist(ex.traveller.pos, ex.fx.places().find(i => i.id === id)!.at)).toBeLessThanOrEqual(TARGET_ARRIVE_M);
      report.push(`${id}: Tab ${tabs}, Up ${r.ups}, turns ${r.turns}, presses ${tabs + 1 + r.ups + r.turns}, silent ${r.silent}`);
    }
    console.log(`beacon bot: ${report.join("; ")}`);
  });
});

describe.skipIf(!hasClinic)("the beacon sounds from the visible path point (agent5 4.6)", () => {
  it("panner azimuth = bearing to the beacon point within 1 degree; with line of sight that is the target's true bearing; the cue is from that point", () => {
    const pkg: BuildingPackage = JSON.parse(readFileSync(CLINIC, "utf8"));
    const { s, ex, clock } = make(pkg);
    while (ex.fx.picked !== "door_3") s.pick(1);
    s.enter();
    const at = ex.fx.places().find(i => i.id === "door_3")!.at;
    let spot: [number, number] | null = null;
    let used: [number, number] | null = null;   // the beacon point the tick sounded from
    const c = new ContinuousSounds(ex.audio, ex.world, { pose: () => ex.traveller, ear: () => ex.ear(), target: () => (used = ex.fx.beaconAim()),
      live: () => true, raf: () => {} });
    let viaCorner = 0, direct = 0;
    for (let i = 0; i < 300 && ex.fx.beaconTarget; i++) {
      const t = ex.traveller;
      (ex.audio.ctx as any).currentTime = i * 2; c.tick(); spot = c.lastHum!.at;
      const aim = used!;
      const az = azimuth(t.pos, t.heading, spot!);
      expect(Math.abs(wrap180(az - wrap180(bearing(t.pos, aim) - t.heading)))).toBeLessThan(1);
      expect(c.hearing()).toMatchObject(heard(wrap180(bearing(t.pos, aim) - t.heading)));
      if (aim[0] === at[0] && aim[1] === at[1]) { direct++; expect(Math.abs(wrap180(az - wrap180(bearing(t.pos, at) - t.heading)))).toBeLessThan(1); }
      else viaCorner++;
      ex.turn(15 * Math.sign(az || 1) * Math.min(1, Math.round(Math.abs(az) / 15))); clock.t += 200;   // a crude walk to visit both cases
      if (Math.abs(az) < 8) { const p = t.pos; ex.step(1); if (t.pos === p) { ex.turn(90); clock.t += 200; ex.step(1); } }
    }
    expect(viaCorner).toBeGreaterThan(0);
    expect(direct).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasClinic)("the beacon on the lab door -> main entrance leg", () => {
  const setup = () => {
    const pkg: BuildingPackage = JSON.parse(readFileSync(CLINIC, "utf8"));
    const { s, ex, clock } = make(pkg);
    while (ex.fx.picked !== "ent_main") s.pick(1);
    s.enter();
    const lab = ex.fx.places().find(i => i.id === "door_3")!.at, ent = ex.fx.places().find(i => i.id === "ent_main")!.at;
    ex.traveller.pos = [lab[0], lab[1]];
    return { ex, clock, ent };
  };
  const same = (a: number[], b: number[]) => dist(a as [number, number], b as [number, number]) < 1e-6;

  it("standing on or near an intermediate path corner: the beacon still sounds, aimed at the next corner", () => {
    const { ex, ent } = setup();
    let corners = 0, checked = 0;
    for (let i = 0; i < 40; i++) {
      const aim = ex.fx.beaconAim()!;
      if (dist(aim, ent) <= 0.5) break;
      corners++;
      // stop on the corner, or anywhere free within 0.25 m of it (inside the 0.3 m mute), arriving along the route
      const p0 = ex.traveller.pos;
      for (const [ox, oy] of [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2], [0.15, 0.15], [-0.15, 0.15], [0.15, -0.15], [-0.15, -0.15]]) {
        const q: [number, number] = [aim[0] + ox, aim[1] + oy];
        if (ex.world.cellAt(q) !== 0) continue;
        ex.traveller.pos = [p0[0], p0[1]]; ex.fx.beaconAim();
        ex.traveller.pos = q; checked++;
        const next = ex.fx.beaconAim()!;
        expect(dist(q, next), `corner ${corners} offset ${ox},${oy}`).toBeGreaterThan(0.3);
        expect(ex.cont.hearing(), `corner ${corners} offset ${ox},${oy}`).not.toBeNull();
      }
      ex.traveller.pos = [aim[0], aim[1]];
    }
    // where the beacon-only bot fell silent: 0.21 m short of the corner at (1.3, -1.1), the next corner not yet in sight
    const { ex: ex2 } = setup();
    ex2.traveller.pos = [1.2546141844835488, -1.3086898634912045];
    expect(dist(ex2.traveller.pos, ex2.fx.beaconAim()!)).toBeGreaterThan(0.3);
    expect(ex2.cont.hearing()).not.toBeNull();
    expect(corners).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(0);
  });

  it("walking the corridor: the beacon point sequence is monotonic along one path (no flip back to a route left behind)", () => {
    const { ex, ent } = setup();
    const plan = findPath(ex.world, ex.traveller.pos, ent)!;
    const idx = (q: number[]) => plan.findIndex(c => same(c, q));
    let last: number[] = [], furthest = -1, changes = 0, flips = 0;
    for (let i = 0; i < 2000 && dist(ex.traveller.pos, ent) > TARGET_ARRIVE_M; i++) {
      const aim = ex.fx.beaconAim()!, p = ex.traveller.pos, d = dist(p, aim);
      if (!same(last, aim)) {
        changes++; last = [aim[0], aim[1]];
        const k = idx(aim);
        if (k >= 0 && k < furthest) flips++;   // a corner of the planned route already passed
        if (k < 0 && furthest >= 0 && !plan.slice(furthest).length) flips++;
        furthest = Math.max(furthest, k);
      }
      const k = Math.min(1, 0.2 / Math.max(d, 1e-6));
      ex.traveller.pos = [p[0] + (aim[0] - p[0]) * k, p[1] + (aim[1] - p[1]) * k];
    }
    expect(dist(ex.traveller.pos, ent)).toBeLessThanOrEqual(TARGET_ARRIVE_M);
    expect(flips).toBe(0);
    expect(changes).toBeLessThanOrEqual(plan.length + 3);   // a fresh route per frame would churn far more
  });
});

describe.skipIf(!hasClinic)("the continuous hum along the lab door -> main entrance leg", () => {
  it("sounds from the next path corner, advances corner by corner, its panner on that corner's true bearing; made and started once", () => {
    const pkg: BuildingPackage = JSON.parse(readFileSync(CLINIC, "utf8"));
    const { s, ex } = make(pkg);
    while (ex.fx.picked !== "ent_main") s.pick(1);
    s.enter();
    const lab = ex.fx.places().find(i => i.id === "door_3")!.at, ent = ex.fx.places().find(i => i.id === "ent_main")!.at;
    ex.traveller.pos = [lab[0], lab[1]];
    const ctx = ex.audio.ctx as any;
    let oscs = 0, starts = 0;
    const mk = ctx.createOscillator.bind(ctx), mkb = ctx.createBufferSource.bind(ctx);
    const counted = (n: any) => { const st = n.start; n.start = (...a: any[]) => { starts++; return st(...a); }; return n; };
    ctx.createOscillator = () => { oscs++; return counted(mk()); };
    ctx.createBufferSource = () => counted(mkb());
    const c = ex.cont;
    const aimOf = ex.fx.beaconAim.bind(ex.fx);
    let aimed: [number, number] | null = null;   // what the frame's own target() call returned
    ex.fx.beaconAim = () => (aimed = aimOf() as [number, number] | null);
    ctx.currentTime = 0; c.tick();
    const v = (c as any).beacon;
    expect(c.humStarts).toBe(6);    // three partials, the noise, the wobble, the on axis click: each started once
    let restarts = 0;
    for (const n of [...v.srcs, v.lfo, v.click.osc]) n.start = () => { restarts++; };
    let px = 0, pz = 0;
    v.panner.positionX.setTargetAtTime = (x: number) => { px = x; return v.panner.positionX; };
    v.panner.positionZ.setTargetAtTime = (z: number) => { pz = z; return v.panner.positionZ; };
    const plan = [ex.traveller.pos, ...findPath(ex.world, ex.traveller.pos, ent)!];
    const seen: [number, number][] = [];
    for (let i = 1; i < 3000 && ex.fx.beaconTarget && dist(ex.traveller.pos, ent) > TARGET_ARRIVE_M; i++) {
      ctx.currentTime = i / 60; c.tick();
      const at = c.lastHum!.at, t = ex.traveller, e = ex.ear();
      expect(dist(at, aimed!)).toBeLessThan(1e-9);                     // the next corner of the path
      expect(Math.abs(wrap180(azimuth(e.pos, e.heading, [px, -pz]) - wrap180(bearing(e.pos, at) - e.heading)))).toBeLessThan(1);
      if (!seen.length || dist(seen.at(-1)!, at) > 1e-9) seen.push([at[0], at[1]]);
      const d = dist(t.pos, at), k = Math.min(1, 0.05 / Math.max(d, 1e-6));     // walk the line at 3 m/s
      t.pos = [t.pos[0] + (at[0] - t.pos[0]) * k, t.pos[1] + (at[1] - t.pos[1]) * k];
    }
    expect(dist(ex.traveller.pos, ent)).toBeLessThanOrEqual(TARGET_ARRIVE_M);
    expect(seen.length).toBeGreaterThan(1);                                         // corner by corner
    // the planned corners come in route order (a corner cut short may add its way round in between), ending on the target
    const ks = seen.map(q => plan.findIndex(p => dist(p, q) < 1e-6)).filter(j => j >= 0);
    expect(new Set(ks).size).toBeGreaterThan(1);
    for (let n = 1; n < ks.length; n++) expect(ks[n]).toBeGreaterThanOrEqual(ks[n - 1]);   // never back to one passed
    expect(dist(seen.at(-1)!, ent)).toBeLessThan(1e-6);
    expect(restarts).toBe(0); expect(c.humStarts).toBe(6); expect(c.droneStarts).toBe(3);                         // never restarted, never made again
    expect(oscs).toBeLessThanOrEqual(8);                                             // the hum's 5 plus the drone's 3
    void starts;
    expect((c as any).beacon).toBe(v);
  });
});
