// Rehearse mode: the run state machine for one route (Task 9). No destination beacon here; B logs a hint.
import { ARRIVE_M, STEP_M } from "../config";
import type { Landmark, PointResult, QuizEntry, Route, RunEvent, RunLog, RunLogKind, RunPlan, Vec2 } from "../types";
import { dist } from "../world";
import type { Priority } from "../audio/speech";

export type RunSpeech = { say(text: string, pri?: Priority): void; readonly speaking: boolean };
export type Pose = { pos: Vec2; heading: number };

export const ADVANCE_M = 0.8;
export const OFF_ROUTE_M = 2.0;
export const HESITATE_MS = 5000;
export const PLAIN_PLAN: RunPlan = { start_segment: 0, repeat_segment: null, extra_cues: false, speech_rate: 1 };

type Deps = {
  speech: RunSpeech;
  plan?: RunPlan;
  landmarks?: Landmark[];
  now?: () => number;
  threadId?: string;
  /** Hesitation counts only while the audio context runs. */
  audioRunning?: () => boolean;
};

/** Distance from p to the segment a-b. */
function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

export function distToPath(p: Vec2, path: Vec2[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return dist(p, path[0]);
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) best = Math.min(best, distToSeg(p, path[i], path[i + 1]));
  return best;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export class RehearsalRun {
  current: number;
  done = false;
  readonly plan: RunPlan;
  readonly log: RunLog;
  private t0 = 0;
  private off = false;
  private idleMs = 0;
  private hesitated = false;
  private cued = new Set<string>();
  private lastPos: Vec2 = [0, 0];
  private now: () => number;
  private speech: RunSpeech;

  constructor(readonly route: Route, private deps: Deps) {
    this.speech = deps.speech;
    this.plan = deps.plan ?? PLAIN_PLAN;
    const last = Math.max(0, route.segments.length - 1);
    this.current = Math.max(0, Math.min(last, this.plan.start_segment));
    this.now = deps.now ?? (() => performance.now());
    this.log = { thread_id: deps.threadId ?? "run", route_id: route.id, events: [], quiz: [], point: [] };
  }

  get segment() { return this.route.segments[this.current]; }

  /** Where the traveller is placed for this run: the start of the first stretch, facing along it. */
  startPose(): Pose {
    const s = this.segment;
    return { pos: [s.start[0], s.start[1]], heading: s.heading_deg };
  }

  begin(p: Pose): void {
    this.t0 = this.now();
    this.lastPos = p.pos;
    this.push("start", p.pos);
    this.enter(this.current);
  }

  /** Call after every step. Returns the events this move produced. */
  onMove(p: Pose): RunEvent[] {
    if (this.done) return [];
    const from = this.log.events.length;
    this.lastPos = p.pos;
    this.idleMs = 0; this.hesitated = false;
    const last = this.route.segments.length - 1;
    if (this.arrived(p.pos)) this.arrive(p.pos);
    while (!this.done && this.current < last && dist(p.pos, this.segment.end) <= ADVANCE_M) {
      this.current++;
      this.push("advance", p.pos);
      this.enter(this.current);
    }
    if (!this.done) { this.checkOffRoute(p.pos); this.cues(p.pos); }
    return this.log.events.slice(from);
  }

  bump(p: Pose): void { if (!this.done) { this.lastPos = p.pos; this.push("bump", p.pos); } }
  hint(p: Pose): void { if (!this.done) { this.lastPos = p.pos; this.push("hint", p.pos); } }

  /** Space: say the current instruction again (no extras). */
  repeatInstruction(): void { this.speech.say(this.segment.instruction, 2); }

  /** Advance the hesitation clock by dtMs. Counts only while nothing is speaking and audio runs. */
  tick(dtMs: number): void {
    if (this.done || this.hesitated) return;
    if (this.speech.speaking || (this.deps.audioRunning && !this.deps.audioRunning())) { this.idleMs = 0; return; }
    this.idleMs += dtMs;
    if (this.idleMs >= HESITATE_MS) {
      this.hesitated = true;
      this.push("hesitate", this.lastPos);
      this.speech.say("Press Space to hear the instruction again.", 0);
    }
  }

  addQuiz(e: QuizEntry): void { this.log.quiz.push(e); }
  addPoint(r: PointResult): void { this.log.point.push(r); }
  elapsedS(): number { return (this.now() - this.t0) / 1000; }

  private push(kind: RunLogKind, pos: Vec2): void {
    this.log.events.push({ t: Math.round(this.now() - this.t0) / 1000, seg: this.current, kind, pos: [pos[0], pos[1]] });
  }

  private enter(i: number): void {
    const s = this.route.segments[i];
    const parts: string[] = [];
    if (s.open_m > 3 && !/open area/i.test(s.instruction))
      parts.push(`Open area for about ${Math.round(s.open_m / STEP_M)} steps, nothing to follow.`);
    parts.push(s.instruction);
    if (this.plan.repeat_segment === i) parts.push(s.instruction);
    this.speech.say(parts.join(" "), 2);
  }

  private arrived(p: Vec2): boolean {
    const end = this.route.path[this.route.path.length - 1];
    if (end && dist(p, end) <= ARRIVE_M) return true;
    const goal = this.deps.landmarks?.find(l => l.id === this.route.to);
    return !!goal && dist(p, goal.pos) <= ARRIVE_M;
  }

  private arrive(p: Vec2): void {
    this.done = true;
    this.push("arrive", p);
    const g = this.deps.landmarks?.find(l => l.id === this.route.to);
    this.speech.say(`You have reached the ${g ? lower(g.label) : "destination"}.`, 2);
  }

  private checkOffRoute(p: Vec2): void {
    if (distToPath(p, this.route.path) > OFF_ROUTE_M) {
      if (this.off) return;
      this.off = true;
      this.push("off_route", p);
      const side = this.segment.wall_side;
      this.speech.say(side === "none" ? "Off route. Press Space to hear the last instruction."
        : `Off route. Wall was on your ${side}.`, 3);
    } else this.off = false;
  }

  private cues(p: Vec2): void {
    if (!this.plan.extra_cues || !this.deps.landmarks) return;
    for (const id of this.segment.landmarks_passed) {
      const l = this.deps.landmarks.find(x => x.id === id);
      if (!l || this.cued.has(id) || dist(p, l.pos) > ARRIVE_M) continue;
      this.cued.add(id);
      this.speech.say(`Passing the ${lower(l.label)}.`, 1);
    }
  }
}
