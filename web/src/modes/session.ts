// Session: Explore -> Rehearse -> point -> quiz -> pocket summary -> run 2 (Tasks 9 and 10 web).
// One KeyActions for the stage; phases decide what each key means.
import { spokenOf } from "../names";
import { describeProv, sourceLine } from "../ui/prov";
import type { Priority, Speech } from "../audio/speech";
import { pulse, PULSE } from "../audio/haptics";
import type { KeyActions } from "../input/keyboard";
import type { ObsMsg } from "../observer/protocol";
import type { BuildingPackage, Landmark, RunEvent } from "../types";
import { fetchCoach as realFetchCoach, scriptedCoach, type CoachResult } from "./coach";
import type { Explore, ExploreHooks } from "./explore";
import { KEYS_LINE } from "./interact";
import { PointTask, POINT_TURN_DEG, pointFeedback } from "./point";
import { buildQuiz, QuizSession } from "./quiz";
import { PLAIN_PLAN, RehearsalRun } from "./rehearse";
import { SummaryReader, summaryLines } from "./summary";

export type Phase = "explore" | "rehearse" | "point" | "quiz" | "summary";

export type SessionDeps = {
  now?: () => number;
  threadId?: string;
  publish?: (m: ObsMsg) => void;
  onPhase?: (p: Phase) => void;
  /** Called when the quiz asks a question, so the page can draw the option buttons. */
  onQuestion?: (q: QuizSession | null) => void;
  fetchCoach?: typeof realFetchCoach;
  audioRunning?: () => boolean;
  /** K: show the keys panel. */
  onKeys?: () => void;
};

const TICK_MS = 250;

export class Session implements KeyActions {
  phase: Phase = "explore";
  runNo = 1;
  run: RehearsalRun | null = null;
  point: PointTask | null = null;
  quiz: QuizSession | null = null;
  coach: CoachResult | null = null;
  reader: SummaryReader | null = null;
  private pointed = false;
  private paused = false;
  private runStarted = false;
  private sent = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  readonly now: () => number;
  /** Used by the window focus guard: pause and resume the hesitation clock. */
  readonly timer = { stop: () => { this.paused = true; }, start: () => { this.paused = false; } };

  constructor(readonly ex: Explore, readonly pkg: BuildingPackage, readonly speech: Speech, hooks: ExploreHooks,
    private deps: SessionDeps = {}) {
    this.now = deps.now ?? (() => performance.now());
    const pub = (m: ObsMsg) => { try { this.deps.publish?.(m); } catch { /* observer must never break the run */ } };
    const prev = speech.onSay;
    speech.onSay = (text, pri) => { prev(text, pri); pub({ v: 1, t: "say", ts: this.now(), text, pri }); };
    hooks.onMove = t => pub({ v: 1, t: "pose", ts: this.now(), pos: [t.pos[0], t.pos[1]], heading: t.heading, cane_deg: t.caneDeg });
    hooks.onTap = (at, code) => pub({ v: 1, t: "tap", ts: this.now(), at, code: code as 0 | 1 | 2 | 3 | 4 | 5 });
    hooks.onStep = t => { if (this.phase === "rehearse" && this.run) this.afterRun(() => this.run!.onMove(t)); };
    hooks.onBump = t => { if (this.phase === "rehearse" && this.run) this.afterRun(() => this.run!.bump(t)); };
    hooks.onHint = t => { if (this.phase === "rehearse" && this.run) this.afterRun(() => this.run!.hint(t)); };
    this.interval = setInterval(() => this.tick(TICK_MS), TICK_MS);
    (this.interval as any)?.unref?.();
  }

  get route() { return this.pkg.routes[0] ?? null; }
  get hasRoute() { return !!this.route; }
  private pub(m: ObsMsg) { try { this.deps.publish?.(m); } catch { /* */ } }
  private say(t: string, p: Priority = 2) { this.speech.say(t, p); }

  private setPhase(p: Phase) { this.phase = p; this.deps.onPhase?.(p); }

  private get goal(): Landmark | null {
    const r = this.route;
    return this.pkg.landmarks.find(l => l.id === r?.to) ?? this.pkg.landmarks.find(l => l.kind === "desk") ?? null;
  }

  destroy(): void { if (this.interval) clearInterval(this.interval); this.interval = null; }

  tick(dtMs: number): void {
    if (this.phase !== "rehearse" || !this.run || this.paused) return;
    this.afterRun(() => this.run!.tick(dtMs));
  }

  /** Run something that may append events, and forward the new events to the observer. */
  private afterRun<T>(f: () => T): T {
    const run = this.run!;
    const before = run.log.events.length;
    const r = f();
    run.log.events.slice(before).forEach(e => this.pubEvent(e));
    if (run.done && this.phase === "rehearse") this.startPoint();
    return r;
  }

  private pubEvent(e: RunEvent) {
    this.pub({ v: 1, t: "event", ts: this.now(), kind: e.kind, seg: e.seg, pos: e.pos });
  }

  // ---- phases -------------------------------------------------------------------------------

  /** Begin run `runNo` with `plan` (Enter in Explore or in the summary). */
  private startRun(plan = PLAIN_PLAN): void {
    const route = this.route!;
    this.runStarted = true;
    this.run = new RehearsalRun(route, {
      speech: this.speech, plan, landmarks: this.pkg.landmarks, now: this.now,
      threadId: this.deps.threadId ?? `run-${Date.now()}`, audioRunning: this.deps.audioRunning,
    });
    if (plan !== PLAIN_PLAN) this.speech.setRate(plan.speech_rate);
    this.ex.rehearse = true; this.ex.locked = false;
    const start = this.run.startPose();
    this.ex.place(start.pos, start.heading);
    this.startedAt = this.now();
    this.paused = false;
    this.setPhase("rehearse");
    this.deps.onQuestion?.(null);
    this.pub({ v: 1, t: "hello", session: this.run.log.thread_id, building_id: this.pkg.id, route_id: route.id, run: this.runNo, mode: "rehearse" });
    this.afterRun(() => this.run!.begin(start));
  }

  private startPoint(): void {
    const goal = this.goal, e = this.pkg.entrances[0];
    if (!goal || !e) { this.finishRun(); return; }
    this.ex.locked = true;
    this.ex.place(e.pos, e.heading_deg);
    this.point = new PointTask(e.pos, e.heading_deg, goal, () => this.ex.audio.play(1, { gain: 0.5, send: 0 }));
    this.pointed = false;
    this.setPhase("point");
    this.point.start((t, p) => this.say(t, p), this.now());
  }

  private confirmPoint(): void {
    const task = this.point!;
    if (this.pointed) return;
    this.pointed = true;
    const r = task.confirm(this.now());
    this.run!.addPoint(r);
    this.pub({ v: 1, t: "point", ts: this.now(), from: r.at, heading: r.heading, target_bearing: r.target_bearing, error_deg: r.error_deg });
    const next = this.runNo === 1 ? "Press Enter for three questions." : "Press Enter for the summary.";
    this.say(`${pointFeedback(r, task.startHeading, spokenOf(task.target))} ${next}`, 2);
  }

  private startQuiz(): void {
    const q = new QuizSession(buildQuiz(this.route!, this.runNo), (t, p) => this.say(t, p), e => {
      this.run!.addQuiz(e);
      this.pub({ v: 1, t: "quiz", ts: this.now(), q: e.q, seg: e.seg, correct: e.correct });
    });
    this.quiz = q;
    this.setPhase("quiz");
    this.deps.onQuestion?.(q);
    q.ask();
  }

  private finishRun(): void {
    const run = this.run!;
    const log = run.log;
    const quizOk = log.quiz.filter(x => x.correct).length;
    this.pub({
      v: 1, t: "end", ts: this.now(), run: this.runNo, arrived: run.done,
      time_s: Math.round(this.now() - this.startedAt) / 1000,
      bumps: log.events.filter(e => e.kind === "bump").length,
      off_route: log.events.filter(e => e.kind === "off_route").length,
      quiz_correct: quizOk, quiz_total: log.quiz.length,
      point_error_deg: log.point.length ? log.point[log.point.length - 1].error_deg : null,
    });
    this.deps.onQuestion?.(null);
    this.setPhase("summary");
    this.reader = new SummaryReader(summaryLines(this.route!), (t, p) => this.say(t, p));
    this.runStarted = false;
    if (this.runNo === 1) this.planNext();
    else this.say("Run 2 complete. Press Space to hear the summary, one stretch at a time.", 2);
  }

  /** Scripted plan straight away; the agent's plan replaces it only if it arrives before run 2 starts. */
  private planNext(): void {
    const n = this.route!.segments.length;
    const log = this.run!.log;
    const local = scriptedCoach(log, n);
    this.coach = local;
    this.announcePlan(local);
    const f = this.deps.fetchCoach ?? realFetchCoach;
    void f(log, this.pkg.id, n).then(r => {
      if (!r || this.runStarted || this.phase !== "summary" || this.runNo !== 1) return;
      this.coach = r;
      this.announcePlan(r, true);
    }).catch(() => undefined);
  }

  private announcePlan(c: CoachResult, replaced = false): void {
    this.pub({ v: 1, t: "plan", ts: this.now(), focus_segment: c.focus_segment, line: c.line, plan: c.plan as any });
    this.deps.onPhase?.("summary");
    if (!replaced) this.say(`Run 1 complete. ${c.line} Press Enter to start run 2, or Space to hear the summary.`, 2);
  }

  // ---- KeyActions ---------------------------------------------------------------------------

  enter(): void {
    switch (this.phase) {
      case "explore":
        if (this.ex.fx.picked) { this.ex.fx.startBeacon(); return; }   // a place was chosen with Tab: go there
        if (!this.hasRoute) { this.say("No route found in this building. Rehearse needs a route.", 2); return; }
        this.runNo = 1;
        this.startRun();
        return;
      case "point":
        if (!this.pointed) { this.say("Turn to face it, then press Space to confirm.", 2); return; }
        if (this.runNo === 1) this.startQuiz(); else this.finishRun();
        return;
      case "quiz":
        if (!this.quiz!.isAnswered) { this.quiz!.repeat(); return; }
        this.quiz!.next();
        if (this.quiz!.finished) this.finishRun(); else this.quiz!.ask();
        this.deps.onQuestion?.(this.quiz!.finished ? null : this.quiz);
        return;
      case "rehearse": this.ex.hint(); return;      // no beacon in Rehearse: Enter is the B hint
      case "summary":
        if (this.runNo === 1) { this.runNo = 2; this.startRun(this.coach?.plan ?? PLAIN_PLAN); }
        else this.say("Both runs are done. Press Space to hear the summary again.", 2);
        return;
      default: return;
    }
  }

  step(dir: 1 | -1): void { this.ex.step(dir); }

  turn(deg: number): void {
    if (this.phase === "point" && this.point) {
      if (this.pointed) return;
      this.point.turn(Math.sign(deg) * POINT_TURN_DEG);
      this.ex.face(this.point.heading);
      return;
    }
    this.ex.turn(deg);
  }

  /** Phone Step button: Confirm while pointing, Step otherwise. */
  stepButton(): void {
    if (this.phase === "point") { if (this.pointed) this.enter(); else this.confirmPoint(); }
    else if (this.phase === "quiz" || this.phase === "summary") this.enter();
    else this.ex.step(1);
  }

  repeat(): void {
    switch (this.phase) {
      case "rehearse": this.run?.repeatInstruction(); return;
      case "point": this.confirmPoint(); return;
      case "quiz": this.quiz?.repeat(); return;
      case "summary": this.reader?.next(); return;
      default: this.ex.repeat();
    }
  }

  options(): void { if (this.phase === "quiz") this.quiz?.repeat(); }
  digit(n: number): void { if (this.phase === "quiz") this.quiz?.answer(n); }

  sweep(d: -1 | 0 | 1): void { if (this.phase === "explore" || this.phase === "rehearse") this.ex.sweep(d); }
  heading(): void {
    if (this.phase === "point" && this.point) { this.say(`You are facing ${this.point.clock()} o'clock.`, 2); return; }
    this.ex.heading();
  }
  where(): void {
    const run = this.phase === "rehearse" ? this.run : null, seg = run?.segment;
    this.ex.where(run && seg ? { i: run.current, n: this.route!.segments.length, steps: seg.steps, wall: seg.wall_side } : undefined);
  }
  hint(): void {
    if (this.phase === "explore" || this.phase === "rehearse") this.ex.hint();
  }
  mono(): void { this.ex.mono(); }
  /** S: the source of the current line (Task 19): the instruction while rehearsing, else the last place named. Shift+S swaps channels. */
  source(): void {
    if (this.phase === "rehearse" && this.run) { this.say(sourceLine(this.pkg, this.route!, this.run.current), 2); return; }
    const it = this.ex.fx.lastItem, p = it ? this.pkg.prov?.[`landmark:${it.id}`] : null;
    this.say(p ? `${it!.name}. ${describeProv(p, this.pkg.prov)}.` : "No source for this line.", 2);
  }
  swap(): void { this.ex.swap(); }
  around(detail: boolean): void { if (this.live) void this.ex.fx.around(detail); }
  ahead(): void { if (this.live) void this.ex.fx.ahead(); }
  pick(dir: 1 | -1): void { if (this.live) this.ex.fx.pick(dir); }
  escape(): void { this.ex.fx.escape(); }
  keys(): void { this.say(KEYS_LINE, 2); this.deps.onKeys?.(); }
  private get live(): boolean { return this.phase === "explore" || this.phase === "rehearse"; }
  rate(d: number): void { this.ex.rate(d); }
  /** Any key interrupts speech (CLAUDE.md rule 7), then resumes a paused AudioContext. */
  any(key?: string): void {
    this.speech.stop();
    if (key !== undefined && !key.startsWith("Arrow")) this.ex.fx.cancel();   // walking keeps a sweep going
    this.ex.any(key);
  }
}
