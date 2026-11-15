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
import { BUMP_HELP, BumpWatcher, closeness, Intro, nextAction, type NextCtx } from "./guide";
import { KEYS_LINE } from "./interact";
import { PointTask, POINT_TURN_DEG, pointFeedback } from "./point";
import { buildQuiz, QuizSession } from "./quiz";
import { ALL_RIGHT, buildCheck, CHECK_START, CheckSession, STRETCH_DONE, weakLine } from "./check";
import type { Route } from "../types";
import { PLAIN_PLAN, RehearsalRun } from "./rehearse";
import { SummaryReader, summaryLines } from "./summary";

export type Phase = "explore" | "rehearse" | "point" | "quiz" | "summary";

export type SessionDeps = {
  now?: () => number;
  threadId?: string;
  publish?: (m: ObsMsg) => void;
  onPhase?: (p: Phase) => void;
  /** Called when the quiz asks a question, so the page can draw the option buttons. */
  onQuestion?: (q: QuizSession | CheckSession | null) => void;
  /** Check yourself: whether its button is offered now, and who chose the weak stretch ("agent" or "scripted"). */
  onCheck?: (s: { available: boolean; source?: "agent" | "scripted"; line?: string }) => void;
  fetchCoach?: typeof realFetchCoach;
  audioRunning?: () => boolean;
  /** K: show the keys panel. */
  onKeys?: () => void;
  /** The one next action changed (bottom strip). */
  onNext?: (text: string) => void;
  /** The intro prompt to draw large, or null. */
  onIntro?: (text: string | null) => void;
  /** Pause or resume all sound (P). */
  onHold?: (on: boolean) => void;
  /** Escape with nothing running: move focus out of the stage. */
  onLeave?: () => void;
  /** Play the arrival chime. */
  chime?: () => void;
  introSeen?: () => boolean;
  introRemember?: () => void;
};

const TICK_MS = 250;

export class Session implements KeyActions {
  phase: Phase = "explore";
  runNo = 1;
  run: RehearsalRun | null = null;
  point: PointTask | null = null;
  quiz: QuizSession | CheckSession | null = null;
  /** Check yourself: the route asked about, and what Enter or Y does after it. */
  checkRoute: Route | null = null;
  offer: { kind: "stretch"; seg: number } | { kind: "whole" } | null = null;
  checkSource: "agent" | "scripted" | null = null;
  private checkRun = 0;
  coach: CoachResult | null = null;
  reader: SummaryReader | null = null;
  private pointed = false;
  private stretch = false;
  private held = false;
  private introEsc = false;
  private introDone = false;
  private lastNext = "";
  private bumps = new BumpWatcher();
  readonly intro: Intro;
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
    hooks.onBump = t => {
      if (this.phase === "rehearse" && this.run) this.afterRun(() => this.run!.bump(t));
      if (this.live && this.bumps.note(this.now())) this.say(BUMP_HELP, 2);
    };
    this.intro = new Intro({ say: t => this.say(t), show: t => this.deps.onIntro?.(t), seen: deps.introSeen, remember: deps.introRemember });
    hooks.onHint = t => { if (this.phase === "rehearse" && this.run) this.afterRun(() => this.run!.hint(t)); };
    this.interval = setInterval(() => this.tick(TICK_MS), TICK_MS);
    (this.interval as any)?.unref?.();
  }

  get route() { return this.pkg.routes[0] ?? null; }
  get hasRoute() { return !!this.route; }
  private pub(m: ObsMsg) { try { this.deps.publish?.(m); } catch { /* */ } }
  private say(t: string, p: Priority = 2) { this.speech.say(t, p); }

  private setPhase(p: Phase) { this.phase = p; this.deps.onIntro?.(null); this.deps.onPhase?.(p); this.refreshNext(); this.refreshCheck(); }

  private get goal(): Landmark | null {
    const r = this.route;
    return this.pkg.landmarks.find(l => l.id === r?.to) ?? this.pkg.landmarks.find(l => l.kind === "desk") ?? null;
  }

  destroy(): void { if (this.interval) clearInterval(this.interval); this.interval = null; }

  /** The text for the bottom strip: one clear next action. */
  next(): string {
    const c: NextCtx = { phase: this.phase, intro: this.intro.active ? this.intro.prompt : null,
      picked: !!this.ex.fx.picked, pointed: this.pointed, answered: this.quiz?.isAnswered, offer: !!this.offer, runNo: this.runNo, hasRoute: this.hasRoute };
    return nextAction(c);
  }
  private refreshNext(): void {
    const t = this.next();
    if (t !== this.lastNext) { this.lastNext = t; this.deps.onNext?.(t); }
  }

  tick(dtMs: number): void {
    this.refreshNext();
    this.refreshCheck();
    if (this.held) return;
    if (this.phase !== "rehearse" || !this.run || this.paused) return;
    this.afterRun(() => this.run!.tick(dtMs));
  }

  /** Run something that may append events, and forward the new events to the observer. */
  private afterRun<T>(f: () => T): T {
    const run = this.run!;
    const before = run.log.events.length;
    const r = f();
    run.log.events.slice(before).forEach(e => this.pubEvent(e));
    if (run.done && this.phase === "rehearse" && !this.stretch) this.startPoint();
    if (run.done && this.stretch) this.refreshCheck();
    return r;
  }

  private pubEvent(e: RunEvent) {
    this.pub({ v: 1, t: "event", ts: this.now(), kind: e.kind, seg: e.seg, pos: e.pos });
  }

  // ---- phases -------------------------------------------------------------------------------

  /** Begin run `runNo` with `plan` (Enter in Explore or in the summary). */
  private startRun(plan = PLAIN_PLAN, route: Route = this.route!, only?: number): void {
    this.runStarted = true;
    this.offer = null; this.checkRoute = null;
    this.run = new RehearsalRun(route, {
      speech: this.speech, plan, landmarks: this.pkg.landmarks, now: this.now,
      threadId: this.deps.threadId ?? `run-${Date.now()}`, audioRunning: this.deps.audioRunning,
      onlySegment: only, stretchDone: STRETCH_DONE,
    });
    this.stretch = only !== undefined;
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
    this.deps.chime?.();
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

  // ---- Check yourself (C) ---------------------------------------------------------------------

  /** C is offered on the summary, in Explore once a leg is walked, and after a practised stretch. */
  get canCheck(): boolean {
    if (!this.hasRoute) return false;
    return this.phase === "summary" || (this.phase === "explore" && this.ex.fx.reached.length > 0)
      || (this.phase === "rehearse" && this.stretch && !!this.run?.done);
  }
  private lastCheck: boolean | null = null;
  refreshCheck(): void { const a = this.canCheck; if (a === this.lastCheck) return; this.lastCheck = a; this.deps.onCheck?.({ available: a }); }

  /** The route the questions are about: on the summary the rehearsed route; in Explore the package route to the last
   *  place reached on the legs (the legs walked), else the rehearsed route. */
  checkRouteNow(): Route {
    if (this.phase === "explore") {
      const r0 = this.route!;
      for (const id of [...this.ex.fx.reached].reverse()) {
        const r = this.pkg.routes.find(x => x.to === id && x.from === r0.from && x.segments.length);
        if (r) return r;
      }
    }
    return this.run?.route ?? this.route!;
  }

  /** C, or the Check yourself button. */
  check(): void {
    if (this.blocked()) return;
    if (!this.canCheck && !(this.phase === "explore" && this.hasRoute)) return;
    const route = this.checkRouteNow();
    this.checkRoute = route; this.offer = null; this.checkSource = null;
    const log = { thread_id: this.deps.threadId ?? "check", route_id: route.id, events: [], quiz: [] as { q: string; seg: number; correct: boolean }[], point: [] };
    this.run = null; this.stretch = false; this.runStarted = false;
    this.ex.rehearse = false; this.ex.locked = true;
    const q = new CheckSession(buildCheck(this.pkg, route), (t, p) => this.say(t, p), e => {
      log.quiz.push(e);
      this.pub({ v: 1, t: "quiz", ts: this.now(), q: e.q, seg: e.seg, correct: e.correct });
    });
    (q as any).log = log;
    this.quiz = q;
    this.setPhase("quiz");
    this.deps.onQuestion?.(q);
    this.lastCheck = false; this.deps.onCheck?.({ available: false });
    void this.speech.sayAsync(CHECK_START, 2).then(() => { if (this.quiz === q && q.i === 0 && !q.isAnswered) q.ask(); });
  }

  private checkEnter(): void {
    const q = this.quiz as CheckSession;
    if (this.offer) { this.acceptOffer(); return; }
    if (q.finished) return;                                  // waiting for the coach
    if (!q.isAnswered) { q.repeat(); return; }
    q.next();
    this.deps.onQuestion?.(q.finished ? null : q);
    if (q.finished) void this.finishCheck(); else q.ask();
  }

  /** The coach path (POST /api/coach) picks the weak stretch; the scripted rules stand in when it is not there. */
  async finishCheck(): Promise<void> {
    const q = this.quiz as CheckSession, route = this.checkRoute!, n = route.segments.length;
    const log = (q as any).log;
    const my = ++this.checkRun;
    const f = this.deps.fetchCoach ?? realFetchCoach;
    let c: CoachResult | null = null;
    try { c = await f(log, this.pkg.id, n, undefined, 2500); } catch { c = null; }
    if (my !== this.checkRun || this.quiz !== q) return;
    if (!c) c = scriptedCoach(log, n);
    this.checkSource = c.source;
    let focus = c.focus_segment;
    if (q.correct < q.questions.length && (focus < 0 || focus >= n)) focus = scriptedCoach(log, n).focus_segment;
    let line: string;
    if (q.correct >= q.questions.length || focus < 0) { this.offer = { kind: "whole" }; line = ALL_RIGHT; }
    else { this.offer = { kind: "stretch", seg: focus }; line = weakLine(this.pkg, route, focus, Math.min(2, q.correct)); }
    this.pub({ v: 1, t: "plan", ts: this.now(), focus_segment: focus, line, plan: c.plan as any });
    this.lastCheck = false; this.deps.onCheck?.({ available: false, source: c.source, line });
    this.refreshNext();
    this.say(line, 2);
  }

  private acceptOffer(): void {
    const o = this.offer!, route = this.checkRoute!;
    this.quiz = null;
    this.deps.onQuestion?.(null);
    this.runNo = 1;
    if (o.kind === "whole") this.startRun(PLAIN_PLAN, route);
    else this.startRun({ start_segment: o.seg, repeat_segment: null, extra_cues: false, speech_rate: 1 }, route, o.seg);
  }

  /** Y: yes to the offer (same as Enter there); elsewhere nothing. */
  yes(): void { if (this.offer && this.phase === "quiz") this.enter(); }

  // ---- KeyActions ---------------------------------------------------------------------------

  private blocked(): boolean {
    if (!this.held) return false;
    this.say("Paused. Press P to resume.", 2);
    return true;
  }

  enter(): void {
    if (this.blocked()) return;
    if (this.phase === "quiz" && this.quiz instanceof CheckSession) { this.checkEnter(); return; }
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
      case "rehearse": this.ex.hint(); return;   // always the hint (rule 7): never a target in Rehearse
      case "summary":
        if (this.runNo === 1) { this.runNo = 2; this.startRun(this.coach?.plan ?? PLAIN_PLAN); }
        else this.say("Both runs are done. Press Space to hear the summary again.", 2);
        return;
      default: return;
    }
  }

  step(dir: 1 | -1): void { if (this.blocked()) return; this.ex.step(dir); }
  /** An Up press inside the step gap: the tick still answers it (no step). */
  stepTick(): void { if (!this.held && this.live && !this.ex.locked) this.ex.caneTick(); }

  turn(deg: number): void {
    if (this.blocked()) return;
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
  /** B: Explore toggles the continuous beacon; Rehearse gives the hint (a 3 pulse burst); elsewhere nothing. */
  beacon(): void {
    if (this.blocked()) return;
    if (this.phase === "explore") this.ex.beacon(); else if (this.phase === "rehearse") this.ex.hint();
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
  escape(): void {
    if (this.introEsc) { this.introEsc = false; return; }          // that Escape only skipped the intro
    const fx = this.ex.fx;
    const busy = fx.busy;
    fx.escape();
    if (!busy && (this.phase === "explore" || this.phase === "summary") && this.deps.onLeave) {
      this.say("Left the rehearsal. Press Enter on Explore to come back.", 2);
      this.deps.onLeave();
    }
  }
  /** P: pause or resume everything (sound, speech and the hesitation clock). */
  pause(): void {
    this.held = !this.held;
    this.say(this.held ? "Paused. Press P to resume." : "Resumed.", 3);
    this.deps.onHold?.(this.held);
  }
  get isHeld(): boolean { return this.held; }
  /** Start the guided intro (first visit only unless forced). */
  startIntro(force = false): boolean { const on = this.intro.start(force); this.refreshNext(); return on; }
  keys(): void { this.say(KEYS_LINE, 2); this.deps.onKeys?.(); }
  /** X (and the summary's Back to Explore button): leave Rehearse, pointing, the quiz or the summary for Explore where
   *  the walker stands. The Explore beacon choice (B) comes back as it was; Enter there starts run 1 again. */
  explore(): void {
    if (this.blocked()) return;
    if (this.phase === "explore") { this.say("Already in Explore.", 2); return; }
    this.run = null; this.point = null; this.quiz = null; this.reader = null;
    this.offer = null; this.checkRoute = null; this.stretch = false; this.checkRun++;
    this.runStarted = false; this.pointed = false; this.runNo = 1;
    this.ex.rehearse = false; this.ex.locked = false;
    this.ex.fx.escapeQuiet();
    this.deps.onQuestion?.(null);
    this.setPhase("explore");
    this.say("Back to Explore.", 2);
  }
  private get live(): boolean { return this.phase === "explore" || this.phase === "rehearse"; }
  rate(d: number): void { this.ex.rate(d); }
  /** Any key interrupts speech (CLAUDE.md rule 7), then resumes a paused AudioContext. */
  any(key?: string): void {
    this.speech.stop();
    if (key !== undefined && this.intro.active) { this.introEsc = this.intro.key(key) === "skip"; if (!this.intro.active) this.introDone = true; }
    else if (this.introDone) { this.introDone = false; this.deps.onIntro?.(null); }   // the closing prompt stays until the next key
    queueMicrotask(() => this.refreshNext());
    if (key !== undefined && !key.startsWith("Arrow")) this.ex.fx.cancel();   // walking keeps a sweep going
    this.ex.any(key);
  }
}
