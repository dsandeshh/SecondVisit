// @vitest-environment jsdom
// Check yourself (C or the button): 3 questions x 4 options from the route, 1-4 answer, R repeats, each question maps to a
// segment, a miss names that segment and Y/Enter rehearses only that stretch; all right offers the whole route; coach
// unavailable -> scripted. Prints the clinic's questions (section f of the task).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AudioEngine } from "../audio/engine";
import { Speech } from "../audio/speech";
import { attachKeys } from "../input/keyboard";
import { FakeAudioContext } from "../test/fakes";
import type { BuildingPackage } from "../types";
import { World } from "../world";
import { ALL_RIGHT, answerLine, buildCheck, CHECK_START, questionLine, STRETCH_DONE, weakLine } from "./check";
import { Explore } from "./explore";
import { Session } from "./session";

const B = (sid: string) => join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "buildings", sid, "package.json");
const has = existsSync(B("x37LjPx62VA"));
const load = (sid: string): BuildingPackage => JSON.parse(readFileSync(B(sid), "utf8"));
const tick = () => new Promise(r => setTimeout(r, 0));

function make(pkg: BuildingPackage, fetchCoach: any = async () => null) {
  document.body.innerHTML = `<p id="say-polite"></p><p id="say-assertive"></p><ol id="say-history"></ol><div id="stage" tabindex="0"></div>`;
  const speech = new Speech({ doc: document, raf: f => f() });
  const said: string[] = [];
  speech.onSay = t => said.push(t);
  const audio = new AudioEngine(speech);
  audio.ctx = new FakeAudioContext() as unknown as AudioContext; (audio as any).build(audio.ctx);
  const hooks = { now: () => 0 };
  const ex = new Explore(new World(pkg), audio, speech, hooks);
  const checks: any[] = [];
  const s = new Session(ex, pkg, speech, hooks, { now: () => 0, threadId: "th", publish: () => {}, fetchCoach, audioRunning: () => true, onCheck: c => checks.push(c) });
  ex.begin();
  const stage = document.getElementById("stage")!;
  attachKeys(stage, s);
  const key = (k: string) => stage.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
  return { s, ex, said, key, checks };
}

describe.runIf(has)("Check yourself on the clinic", () => {
  it("prints the questions and lines for both routes (task section f)", () => {
    const pkg = load("x37LjPx62VA");
    for (const rt of pkg.routes) {
      const qs = buildCheck(pkg, rt);
      console.log(`ROUTE ${rt.id}`);
      qs.forEach((q, k) => console.log(`  Q${k + 1} [segment ${q.seg}] ${q.q} | ${q.options.map((o, i) => `${i + 1}) ${o}`).join("  ")} | correct: ${q.answer + 1}) ${q.options[q.answer]}`));
      console.log(`  MISS Q1: ${weakLine(pkg, rt, qs[0].seg, 2)}`);
      console.log(`  ALL RIGHT: ${ALL_RIGHT}`);
    }
  });

  it("every spoken Check line has a voice line (and so a clip), and none says possibly", () => {
    for (const sid of ["x37LjPx62VA", "hpGRjK5uFPW"]) {
      if (!existsSync(B(sid))) continue;
      const pkg = load(sid);
      const vl = new Set((pkg.voice_lines ?? []).map(v => v.text));
      const lines = [CHECK_START, ALL_RIGHT, STRETCH_DONE];
      for (const rt of pkg.routes) {
        const qs = buildCheck(pkg, rt);
        expect(qs).toHaveLength(3);
        qs.forEach((q, k) => {
          expect(q.options).toHaveLength(4);
          expect(new Set(q.options).size).toBe(4);
          expect(q.answer).toBeGreaterThanOrEqual(0);
          expect(q.seg).toBeGreaterThanOrEqual(0); expect(q.seg).toBeLessThan(rt.segments.length);
          lines.push(questionLine(k, q), ...q.options.flatMap(o => [answerLine(true, o), answerLine(false, o)]));
        });
        rt.segments.forEach((_, i) => [0, 1, 2].forEach(c => lines.push(weakLine(pkg, rt, i, c))));
      }
      for (const l of lines) { expect(vl.has(l), `${sid}: ${l}`).toBe(true); expect(l).not.toMatch(/possibly|wrong|fail/i); }
    }
  });

  it("C on the summary: 3 questions, R repeats, a miss names that stretch, Y rehearses only it (scripted label)", async () => {
    const pkg = load("x37LjPx62VA");
    const { s, ex, said, key, checks } = make(pkg);
    (s as any).setPhase("summary");
    expect(s.canCheck).toBe(true);
    key("c"); await tick();
    expect(said).toContain(CHECK_START);
    const qs = (s.quiz as any).questions;
    expect(said.at(-1)).toBe(questionLine(0, qs[0]));
    said.length = 0; key("r"); expect(said.at(-1)).toBe(questionLine(0, qs[0]));
    key(String(((qs[0].answer + 1) % 4) + 1));          // a miss on question 1
    expect(said.at(-1)).toBe(answerLine(false, qs[0].options[qs[0].answer]));
    for (let k = 1; k < 3; k++) { key("Enter"); key(String(qs[k].answer + 1)); }
    key("Enter"); await tick(); await tick();
    const route = pkg.routes[0];
    expect(said.at(-1)).toBe(weakLine(pkg, route, qs[0].seg, 2));
    expect(checks.at(-1).source).toBe("scripted");
    key("y");
    expect(s.phase).toBe("rehearse");
    const seg = route.segments[qs[0].seg];
    expect(ex.traveller.pos).toEqual([seg.start[0], seg.start[1]]);
    expect(s.run!.current).toBe(qs[0].seg);
    s.run!.onMove({ pos: [seg.end[0], seg.end[1]], heading: seg.heading_deg });
    expect(s.run!.done).toBe(true);
    expect(said.at(-1)).toBe(STRETCH_DONE);
    expect(s.phase).toBe("rehearse");                      // no pointing task: that stretch only
    expect(s.canCheck).toBe(true);
  });

  it("C in Explore after a leg asks about the legs' route; all right offers the whole route; the agent's pick is labelled", async () => {
    const pkg = load("x37LjPx62VA");
    const agent = async () => ({ plan: { start_segment: 0, repeat_segment: null, extra_cues: false, speech_rate: 1 }, focus_segment: -1, line: "x", source: "agent" });
    const { s, ex, said, key, checks } = make(pkg, agent);
    expect(s.canCheck).toBe(false);
    ex.fx.reached.push("desk_1", "door_3");
    expect(s.canCheck).toBe(true);
    key("c"); await tick();
    expect(s.checkRoute!.id).toBe("ent_main__door_3");
    const qs = (s.quiz as any).questions;
    for (let k = 0; k < 3; k++) { if (k) key("Enter"); key(String(qs[k].answer + 1)); }
    key("Enter"); await tick(); await tick();
    expect(said.at(-1)).toBe(ALL_RIGHT);
    expect(checks.at(-1).source).toBe("agent");
    key("Enter");
    expect(s.phase).toBe("rehearse");
    expect(s.run!.route.id).toBe("ent_main__door_3");
    expect(s.run!.current).toBe(0);
  });
});
