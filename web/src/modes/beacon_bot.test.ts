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
import { heard } from "../audio/beacon_cue";
import { AudioEngine } from "../audio/engine";
import { azimuth } from "../audio/space";
import { Speech } from "../audio/speech";
import { FakeAudioContext } from "../test/fakes";
import type { BuildingPackage } from "../types";
import { bearing, dist, wrap180, World } from "../world";
import { Explore } from "./explore";
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
    const h = ex.cont.hearing();
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
    const c = new ContinuousSounds(ex.audio, ex.world, { pose: () => ex.traveller, ear: () => ex.ear(), target: () => ex.fx.beaconAim(),
      live: () => true, raf: () => {}, onPulse: p => { spot = [p[0], p[1]]; } });
    let viaCorner = 0, direct = 0;
    for (let i = 0; i < 300 && ex.fx.beaconTarget; i++) {
      const t = ex.traveller, aim = ex.fx.beaconAim()!;
      spot = null; (ex.audio.ctx as any).currentTime = i * 2; c.tick();
      const az = azimuth(t.pos, t.heading, spot!);
      expect(Math.abs(wrap180(az - wrap180(bearing(t.pos, aim) - t.heading)))).toBeLessThan(1);
      expect(c.hearing()).toEqual(heard(wrap180(bearing(t.pos, aim) - t.heading)));
      if (aim[0] === at[0] && aim[1] === at[1]) { direct++; expect(Math.abs(wrap180(az - wrap180(bearing(t.pos, at) - t.heading)))).toBeLessThan(1); }
      else viaCorner++;
      ex.turn(15 * Math.sign(az || 1) * Math.min(1, Math.round(Math.abs(az) / 15))); clock.t += 200;   // a crude walk to visit both cases
      if (Math.abs(az) < 8) { const p = t.pos; ex.step(1); if (t.pos === p) { ex.turn(90); clock.t += 200; ex.step(1); } }
    }
    expect(viaCorner).toBeGreaterThan(0);
    expect(direct).toBeGreaterThan(0);
  });
});
