import { describe, expect, it } from "vitest";
import { STEP_M } from "../config";
import type { Route, Vec2 } from "../types";
import { fixturePkg } from "../test/fakes";
import { RehearsalRun, type RunSpeech } from "./rehearse";

const route = (): Route => fixturePkg().routes[0];
const at = (p: Vec2) => ({ pos: p, heading: 90 });

function setup(plan?: any, opts: { speaking?: () => boolean } = {}) {
  const said: { text: string; pri: number }[] = [];
  const speech: RunSpeech = {
    say: (text, pri = 2) => { said.push({ text, pri }); },
    get speaking() { return opts.speaking?.() ?? false; },
  };
  let clock = 0;
  const run = new RehearsalRun(route(), { speech, plan, now: () => clock, threadId: "th", landmarks: fixturePkg().landmarks });
  return { run, said, advance: (ms: number) => { clock += ms; } };
}

describe("RehearsalRun", () => {
  it("speaks the first instruction on begin and logs start", () => {
    const { run, said } = setup();
    run.begin(at([0.5, 6]));
    expect(said[0].text).toContain(route().segments[0].instruction);
    expect(run.log.events[0].kind).toBe("start");
    expect(run.log.route_id).toBe("r1");
    expect(run.log.thread_id).toBe("th");
  });

  it("advance on reaching segment end", () => {
    const { run, said } = setup();
    run.begin(at([0.5, 6]));
    const ev = run.onMove(at([7.5, 6]));
    expect(ev.map(e => e.kind)).toContain("advance");
    expect(run.current).toBe(1);
    expect(said.at(-1)!.text).toContain(route().segments[1].instruction);
  });

  it("off_route fires once per excursion", () => {
    const { run } = setup();
    run.begin(at([0.5, 6]));
    const kinds = () => run.log.events.filter(e => e.kind === "off_route").length;
    run.onMove(at([3, 9.5])); run.onMove(at([3.5, 9.8])); run.onMove(at([4, 10]));
    expect(kinds()).toBe(1);
    run.onMove(at([3, 6])); // back on the path
    run.onMove(at([3, 9.5]));
    expect(kinds()).toBe(2);
  });

  it("off route says which side the wall was on", () => {
    const { run, said } = setup();
    run.begin(at([0.5, 6]));
    run.onMove(at([8, 6])); run.onMove(at([8, 10.0])); run.onMove(at([8, 10.8]));
    expect(run.current).toBe(2);
    run.onMove(at([14, 4]));
    expect(said.at(-1)!.text).toBe("Off route. Wall was on your left.");
  });

  it("off route with no wall side uses the generic line", () => {
    const { run, said } = setup();
    run.begin(at([0.5, 6]));
    run.onMove(at([3, 9.5]));
    expect(said.at(-1)!.text).toBe("Off route. Press Space to hear the last instruction.");
  });

  it("arrive ends run", () => {
    const { run, said } = setup({ start_segment: 2, repeat_segment: null, extra_cues: false, speech_rate: 1 });
    run.begin(at([8, 10.8]));
    const ev = run.onMove(at([17, 10.8]));
    expect(ev.map(e => e.kind)).toContain("arrive");
    expect(run.done).toBe(true);
    expect(said.at(-1)!.text).toBe("You have reached the reception desk.");
    expect(run.onMove(at([3, 3]))).toEqual([]);
  });

  it("plan.start_segment starts there", () => {
    const { run, said } = setup({ start_segment: 1, repeat_segment: null, extra_cues: false, speech_rate: 0.9 });
    run.begin(at([8, 6]));
    expect(run.current).toBe(1);
    expect(said[0].text).toContain(route().segments[1].instruction);
    expect(run.startPose().pos).toEqual([8, 6]);
  });

  it("repeat_segment is spoken twice on entry", () => {
    const { run, said } = setup({ start_segment: 0, repeat_segment: 1, extra_cues: false, speech_rate: 1 });
    run.begin(at([0.5, 6]));
    run.onMove(at([7.5, 6]));
    const t = said.at(-1)!.text;
    expect(t.split(route().segments[1].instruction).length - 1).toBe(2);
  });

  it("hesitates after 5 s without a step, once, then hints Space", () => {
    const { run, said, advance } = setup();
    run.begin(at([0.5, 6]));
    advance(5200); run.tick(5200);
    run.tick(1000);
    expect(run.log.events.filter(e => e.kind === "hesitate").length).toBe(1);
    expect(said.at(-1)).toEqual({ text: "Press Space to hear the instruction again.", pri: 0 });
  });

  it("hesitate not logged while speaking", () => {
    const { run } = setup(undefined, { speaking: () => true });
    run.begin(at([0.5, 6]));
    run.tick(6000);
    expect(run.log.events.some(e => e.kind === "hesitate")).toBe(false);
  });

  it("a step resets the hesitation clock", () => {
    const { run } = setup();
    run.begin(at([0.5, 6]));
    run.tick(4000); run.onMove(at([1.2, 6])); run.tick(4000);
    expect(run.log.events.some(e => e.kind === "hesitate")).toBe(false);
  });

  it("hint logged on B", () => {
    const { run } = setup();
    run.begin(at([0.5, 6]));
    run.hint(at([1, 6]));
    expect(run.log.events.at(-1)!.kind).toBe("hint");
  });

  it("bump logged", () => {
    const { run } = setup();
    run.begin(at([0.5, 6]));
    run.bump(at([0.5, 6]));
    expect(run.log.events.at(-1)!.kind).toBe("bump");
  });

  it("open area line uses package open_m", () => {
    const { run, said } = setup();
    run.begin(at([0.5, 6]));
    const open = said.find(s => s.text.startsWith("Open area"))!;
    expect(open.text).toContain(`about ${Math.round(route().segments[0].open_m / STEP_M)} steps`);
  });

  it("extra cues name a landmark once when passing", () => {
    const pkg = fixturePkg();
    pkg.routes[0].segments[1].landmarks_passed = ["pil"];
    const lms = [...pkg.landmarks, { id: "pil", kind: "pillar" as const, label: "Pillar", pos: [8, 8] as Vec2, confidence: 1, fixed: true }];
    const said: string[] = [];
    const run = new RehearsalRun(pkg.routes[0], { speech: { say: t => { said.push(t); }, speaking: false },
      plan: { start_segment: 1, repeat_segment: null, extra_cues: true, speech_rate: 0.9 },
      landmarks: lms, now: () => 0, threadId: "t" });
    run.begin(at([8, 6]));
    run.onMove(at([8, 7.5])); run.onMove(at([8, 8]));
    expect(said.filter(t => t.includes("Passing the pillar")).length).toBe(1);
  });
});
