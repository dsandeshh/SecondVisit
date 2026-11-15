// @vitest-environment jsdom
// The three leg demo on the clinic (main entrance -> reception desk -> lab door -> main entrance), each leg by Tab, Enter
// and walking towards the continuous beacon; arrival is said once and the beacon stops. Also X back to Explore.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AudioEngine } from "../audio/engine";
import { beaconAz } from "../audio/continuous";
import { Speech } from "../audio/speech";
import { attachKeys } from "../input/keyboard";
import { FakeAudioContext, fixturePkg } from "../test/fakes";
import type { BuildingPackage } from "../types";
import { dist, World } from "../world";
import { Explore } from "./explore";
import { KEYS_LINE, TARGET_ARRIVE_M } from "./interact";
import { Session } from "./session";

const CLINIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "buildings", "x37LjPx62VA", "package.json");
const hasClinic = existsSync(CLINIC);
const clinic = (): BuildingPackage => JSON.parse(readFileSync(CLINIC, "utf8"));

function make(pkg: BuildingPackage) {
  document.body.innerHTML = `<p id="say-polite"></p><p id="say-assertive"></p><ol id="say-history"></ol><div id="stage" tabindex="0"></div><p id="target-line"></p>`;
  const speech = new Speech({ doc: document, raf: f => f() });
  const said: string[] = [];
  speech.onSay = t => said.push(t);
  const audio = new AudioEngine(speech);
  audio.ctx = new FakeAudioContext() as unknown as AudioContext; (audio as any).build(audio.ctx);
  const clock = { t: 0 };
  const hooks = { now: () => clock.t };
  const ex = new Explore(new World(pkg), audio, speech, hooks);
  const s = new Session(ex, pkg, speech, hooks, { now: () => clock.t, threadId: "th", publish: () => {}, fetchCoach: async () => null, audioRunning: () => true });
  ex.begin();
  return { s, ex, said, clock };
}

/** Tab until `id` is highlighted; the number of presses. */
function tabTo(s: Session, ex: Explore, id: string): number {
  for (let n = 1; n <= 60; n++) { s.pick(1); if (ex.fx.picked === id) return n; }
  throw new Error(`Tab never reached ${id}`);
}

/** Follow the beacon: face the beacon's direction (to the nearest 15 degrees, as the arrows turn), step; on a bump try the
 *  nearest free heading either side (the cane and proximity tick find the opening), keep that side while blocked. The
 *  number of Up presses and turn presses, or Infinity if the beacon never led there. */
function followBeacon(ex: Explore, max = 400): { ups: number; turns: number } {
  let ups = 0, turns = 0, side = 0, slide = 0;
  const t = ex.traveller;
  for (let i = 0; i < max; i++) {
    const aim = ex.fx.beaconAim();
    if (!aim) return { ups, turns };                     // arrived: the beacon stopped
    const want = beaconAz(t.pos, t.heading, aim);
    let k = Math.round(want / 15);
    if (slide > 0) { k = 0; slide--; }                   // keep sliding along the wall a few steps
    if (k) { ex.turn(k * 15); turns += Math.abs(k); }
    const before = t.pos;
    ex.step(1); ups++;
    if (t.pos !== before) continue;
    const order = side ? [side] : [1, -1];
    let moved = false;
    for (let a = 1; a <= 11 && !moved; a++) for (const sd of order) {
      const h0 = t.heading;
      t.setHeading(h0 + sd * a * 15);
      const p = t.pos; ex.step(1); ups++;
      if (t.pos !== p) { turns += a; side = sd; slide = 3; moved = true; break; }
      t.setHeading(h0);
    }
    if (!moved) return { ups: Infinity, turns };
  }
  return { ups: Infinity, turns };
}

describe("Tab order: route destinations in order, then the entrances, then the rest", () => {
  it("fixture: the destination first, then the entrance", () => {
    const pkg = fixturePkg();
    const { s, ex } = make(pkg);
    s.pick(1); expect(ex.fx.picked).toBe(pkg.routes[0].to);
    s.pick(1); expect(ex.fx.picked).toBe(pkg.entrances[0].id);
  });
  it.skipIf(!hasClinic)("clinic: reception desk, lab door, main entrance are the first three", () => {
    const pkg = clinic();
    const { ex } = make(pkg);
    expect(ex.fx.places().slice(0, 3).map(i => i.id)).toEqual(["dest", "door_3", "ent_main"]);
    expect(ex.fx.places()[2].name).toBe("Main entrance");
  });
});

describe.skipIf(!hasClinic)("the three leg demo on the clinic", () => {
  it("each leg: Tab, Enter, follow the beacon; arrival said once, beacon stops; the next Tab is one press", () => {
    const pkg = clinic();
    const { s, ex, said } = make(pkg);
    const legs: [string, string][] = [["dest", "You have reached the reception desk."], ["door_3", "You have reached the lab door."], ["ent_main", "You have reached the main entrance."]];
    const report: string[] = [];
    for (const [id, line] of legs) {
      const tabs = tabTo(s, ex, id);
      expect(tabs).toBeLessThanOrEqual(2);
      s.enter();
      expect(s.phase).toBe("explore");
      expect(ex.fx.beaconTarget?.id).toBe(id);
      const n0 = said.length;
      const r = followBeacon(ex);
      expect(r.ups, `leg to ${id}`).toBeLessThan(Infinity);
      const at = ex.fx.places().find(i => i.id === id)!.at;
      expect(dist(ex.traveller.pos, at)).toBeLessThanOrEqual(TARGET_ARRIVE_M);
      expect(said.slice(n0).filter(t => t === line)).toHaveLength(1);
      expect(ex.fx.beaconTarget).toBeNull();
      ex.cont.tick();
      expect(ex.cont.beaconRunning).toBe(false);
      for (let i = 0; i < 4; i++) { ex.turn(90); ex.step(1); ex.turn(180); ex.step(1); }   // milling about at the target
      expect(said.filter(t => t === line)).toHaveLength(1);
      report.push(`${id}: Tab ${tabs}, Enter 1, Up ${r.ups}, turns ${r.turns}`);
    }
    console.log(`demo legs: ${report.join("; ")}`);
  });
});

describe("X: back to Explore", () => {
  it("from Rehearse and from the summary; the Explore beacon choice comes back", () => {
    const { s, ex, said } = make(fixturePkg());
    s.beacon();                                       // B: off
    expect(ex.cont.beaconOn).toBe(false);
    s.enter(); expect(s.phase).toBe("rehearse");
    const stage = document.getElementById("stage")!;
    attachKeys(stage, s);
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expect(s.phase).toBe("explore");
    expect(ex.rehearse).toBe(false);
    expect(said.at(-1)).toBe("Back to Explore.");
    expect(ex.cont.beaconOn).toBe(false);             // still off, as the visitor left it
    s.beacon(); expect(ex.cont.beaconOn).toBe(true);
    s.enter(); expect(s.phase).toBe("rehearse");
    (s as any).finishRun();                           // jump to the summary
    expect(s.phase).toBe("summary");
    s.explore();
    expect(s.phase).toBe("explore");
    expect(ex.cont.beaconOn).toBe(true);
    expect(ex.locked).toBe(false);
    s.enter(); expect(s.phase).toBe("rehearse");      // a run can be repeated
    expect(s.runNo).toBe(1);
  });
  it("the keys line names B, V and X", () => {
    expect(KEYS_LINE).toMatch(/B: beacon/);
    expect(KEYS_LINE).toMatch(/V: photo view/);
    expect(KEYS_LINE).toMatch(/X: back to Explore/);
  });
});
