// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { AudioEngine } from "../audio/engine";
import { Speech } from "../audio/speech";
import { fakeSynth, fixturePkg } from "../test/fakes";
import { World } from "../world";
import { Explore } from "./explore";
import { Session, type Phase } from "./session";

function make(opts: { routes?: boolean } = {}) {
  document.body.innerHTML = `<p id="say-polite"></p><p id="say-assertive"></p><ol id="say-history"></ol>`;
  const pkg = fixturePkg();
  if (opts.routes === false) pkg.routes = [];
  const speech = new Speech({ synth: fakeSynth() as any, Utterance: class { constructor(public text: string) {} } as any, doc: document, raf: f => f() });
  speech.setOutput("screenreader"); // lines land in the transcript only
  const said: string[] = [];
  speech.onSay = t => said.push(t);
  const audio = new AudioEngine(speech);
  const hooks = {};
  const ex = new Explore(new World(pkg), audio, speech, hooks);
  const phases: Phase[] = [];
  const sent: any[] = [];
  const s = new Session(ex, pkg, speech, hooks, {
    now: () => 0, threadId: "th", publish: m => sent.push(m), onPhase: p => phases.push(p),
    fetchCoach: async () => null, audioRunning: () => true,
  });
  ex.begin();
  return { s, ex, said, phases, sent, pkg };
}

const walkToDesk = (ex: Explore) => { ex.traveller.pos = [16.6, 10.8]; ex.traveller.setHeading(90); ex.step(1); };

describe("Session flow", () => {
  it("Enter in Explore starts the rehearsal at the route start and speaks stretch 1", () => {
    const { s, ex, said, phases } = make();
    s.enter();
    expect(s.phase).toBe("rehearse");
    expect(phases.at(-1)).toBe("rehearse");
    expect(ex.rehearse).toBe(true);
    expect(ex.traveller.pos).toEqual([0.5, 6]);
    expect(said.at(-1)).toContain("Walk about 11 steps");
  });

  it("no route says so and stays in Explore", () => {
    const { s, said } = make({ routes: false });
    s.enter();
    expect(s.phase).toBe("explore");
    expect(said.at(-1)).toMatch(/No route found/);
  });

  it("arriving leads straight into the pointing task at the entrance", () => {
    const { s, ex, said } = make();
    s.enter();
    walkToDesk(ex);
    expect(s.phase).toBe("point");
    expect(ex.traveller.pos).toEqual(s.pkg.entrances[0].pos);
    expect(said.some(t => /You are back at the entrance, facing into the building\. Turn to face the reception desk, then press Space\./.test(t))).toBe(true);
    expect(said.some(t => /degrees/.test(t))).toBe(false);
  });

  it("pointing: arrows turn 5 degrees, Space confirms, then quiz, summary, run 2", () => {
    const { s, ex, said, sent, phases } = make();
    s.enter(); walkToDesk(ex);
    s.turn(15); s.turn(15); s.turn(-15);
    expect(s.point!.heading).toBeCloseTo(90 + 5);
    s.step(1); // walking is off while pointing
    s.turn(-5 * 4 / 1); // -20 -> -6.67 steps of 5: 
    s.repeat(); // confirm
    expect(said.at(-1)).toMatch(/degrees off\. [A-Za-z' ]+\. The reception desk is at \d+ o'clock from here\./);
    expect(s.run!.log.point.length).toBe(1);
    expect(sent.some(m => m.t === "point")).toBe(true);
    s.enter();
    expect(s.phase).toBe("quiz");
    expect(said.at(-1)).toMatch(/Question 1 of 3/);
    for (let i = 0; i < 3; i++) { s.digit(1); s.enter(); }
    expect(s.phase).toBe("summary");
    expect(s.run!.log.quiz.length).toBe(3);
    expect(sent.filter(m => m.t === "quiz").length).toBe(3);
    expect(sent.some(m => m.t === "plan")).toBe(true);
    expect(sent.some(m => m.t === "end")).toBe(true);
    expect(s.coach?.source).toBe("scripted");
    s.enter(); // start run 2
    expect(s.phase).toBe("rehearse");
    expect(s.runNo).toBe(2);
    expect(phases).toContain("summary");
  });

  it("Space in the summary reads one stretch per press", () => {
    const { s, ex, said } = make();
    s.enter(); walkToDesk(ex); s.repeat(); s.enter();
    for (let i = 0; i < 3; i++) { s.digit(1); s.enter(); }
    s.repeat();
    expect(said.at(-1)).toMatch(/^Stretch 1\./);
    s.repeat();
    expect(said.at(-1)).toMatch(/^Stretch 2\./);
  });

  it("run 2 ends with a pointing task and no quiz", () => {
    const { s, ex } = make();
    s.enter(); walkToDesk(ex); s.repeat(); s.enter();
    for (let i = 0; i < 3; i++) { s.digit(1); s.enter(); }
    s.enter();
    walkToDesk(ex);
    expect(s.phase).toBe("point");
    s.repeat(); s.enter();
    expect(s.phase).toBe("summary");
    expect(s.runNo).toBe(2);
  });

  it("hesitation ticks only in rehearse and log hint on B", () => {
    const { s, ex } = make();
    s.tick(6000);
    s.enter();
    s.tick(6000);
    expect(s.run!.log.events.some(e => e.kind === "hesitate")).toBe(true);
    s.hint();
    expect(s.run!.log.events.at(-1)!.kind).toBe("hint");
    void ex;
  });

  it("agent coach plan replaces the scripted one only before run 2 starts", async () => {
    const { s, ex } = make();
    const agent = { plan: { start_segment: 0, repeat_segment: 1, extra_cues: true, speech_rate: 0.8 }, focus_segment: 1, line: "Agent line.", source: "agent" as const };
    (s as any).deps.fetchCoach = async () => agent;
    s.enter(); walkToDesk(ex); s.repeat(); s.enter();
    for (let i = 0; i < 3; i++) { s.digit(1); s.enter(); }
    await Promise.resolve(); await Promise.resolve();
    expect(s.coach?.source).toBe("agent");
    s.enter();
    expect(s.run!.plan.speech_rate).toBe(0.8);
  });

  it("publishes hello and events to the observer", () => {
    const { s, sent } = make();
    s.enter();
    expect(sent.find(m => m.t === "hello")).toMatchObject({ route_id: "r1", building_id: "fixture", run: 1 });
    expect(sent.some(m => m.t === "event" && m.kind === "start")).toBe(true);
    void vi;
  });
});
