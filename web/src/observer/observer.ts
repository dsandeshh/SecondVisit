import "../styles/tokens.css";
import { openBus } from "./bus";
import { validMsg } from "./protocol";
import type { CellCode, EndMsg, ObsMsg, PackageLite, Vec2 } from "./protocol";

const TAP_MS = 300;

/** Pure observer state: no DOM, no clock. Message `ts` values order everything. */
export class ObserverState {
  trails: Record<number, Vec2[]> = {};
  lastSay = "";
  taps: { at: Vec2; code: CellCode; ts: number; rx: number }[] = [];
  summary: Record<number, EndMsg> = {};
  /** Positioned sounds from the cue bus, drawn as short ripples (same events the headphones and the 3D ring get). */
  cues: { at: Vec2; kind: string; label: string; ts: number; rx: number }[] = [];
  lastCue = "";
  quiz: { q: string; seg: number; correct: boolean }[] = [];
  events: { kind: string; seg: number; pos: Vec2; ts: number }[] = [];
  points: Record<number, { from: Vec2; heading: number; target_bearing: number; error_deg: number }> = {};
  coach: { line: string; focus_segment: number } | null = null;
  hello: { building_id: string; route_id: string; mode: string } | null = null;
  run = 1;
  pose: { pos: Vec2; heading: number; cane_deg: number } | null = null;
  seg = 0;
  private latest = -Infinity;

  apply(m: ObsMsg): void {
    if (!validMsg(m)) return;
    if (m.t === "hello") {
      this.hello = { building_id: m.building_id, route_id: m.route_id, mode: m.mode };
      if (m.run !== this.run) { this.run = m.run; this.quiz = []; this.seg = 0; }
      this.trails[m.run] ??= [];
      return;
    }
    this.latest = Math.max(this.latest, m.ts);
    switch (m.t) {
      case "pose":
        this.pose = { pos: m.pos, heading: m.heading, cane_deg: m.cane_deg };
        (this.trails[this.run] ??= []).push(m.pos);
        break;
      case "tap": this.taps.push({ at: m.at, code: m.code, ts: m.ts, rx: performance.now() }); break;
      case "say": this.lastSay = m.text; break;
      case "cue":
        this.lastCue = m.kind;
        if (m.at) this.cues.push({ at: m.at, kind: m.kind, label: m.label ?? m.text ?? "", ts: m.ts, rx: performance.now() });
        this.cues = this.cues.slice(-12);
        break;
      case "event": this.seg = m.seg; this.events.push({ kind: m.kind, seg: m.seg, pos: m.pos, ts: m.ts }); break;
      case "quiz": this.quiz.push({ q: m.q, seg: m.seg, correct: m.correct }); break;
      case "point": this.points[this.run] = { from: m.from, heading: m.heading, target_bearing: m.target_bearing, error_deg: m.error_deg }; break;
      case "plan": this.coach = { line: m.line, focus_segment: m.focus_segment }; break;
      case "end": this.summary[m.run] = m; break;
    }
    this.taps = this.taps.filter((t) => t.ts >= this.latest - TAP_MS);
  }
}

/** Before/after table as plain strings (rendered with textContent, never innerHTML). */
export function tableRows(summary: Record<number, EndMsg>): string[][] {
  const n = (v: number) => String(Number(v));
  const col = (f: (e: EndMsg) => string) => [1, 2].map((r) => (summary[r] ? f(summary[r]) : ""));
  return [
    ["", "Run 1", "Run 2"],
    ["Time", ...col((e) => `${Math.round(Number(e.time_s))} s`)],
    ["Bumps", ...col((e) => n(e.bumps))],
    ["Off route", ...col((e) => n(e.off_route))],
    ["Quiz", ...col((e) => `${n(e.quiz_correct)} of ${n(e.quiz_total)}`)],
    ["Pointing error", ...col((e) => (e.point_error_deg == null ? "none" : `${Math.round(Number(e.point_error_deg))}\u00b0`))],
  ];
}

if (typeof document !== "undefined" && document.getElementById("plan")) {
  void import("./render").then((r) => r.start(ObserverState, openBus));
}
export type { PackageLite };
