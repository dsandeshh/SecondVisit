// Coach on the web: scripted mirror of engine coach rules plus the /api/coach call (Task 10).
// Nobody waits on the model: the scripted plan is used straight away; the agent's plan replaces it only
// if it arrives before the user starts run 2. The scripted path is always labelled "scripted".
import type { RunLog, RunPlan } from "../types";

export type CoachResult = { plan: RunPlan; focus_segment: number; line: string; source: "scripted" | "agent" };

const W = { wrong: 2.0, off_route: 1.5, hesitate: 1.0, hint: 1.0, bump: 0.5 } as const;

export function tally(log: RunLog, n: number): number[] {
  const t = new Array<number>(n).fill(0);
  const add = (seg: number, w: number) => { if (seg >= 0 && seg < n) t[seg] += w; };
  for (const q of log.quiz) if (!q.correct) add(q.seg, W.wrong);
  for (const e of log.events) if (e.kind in W) add(e.seg, W[e.kind as keyof typeof W]);
  return t;
}

export function chooseFocus(log: RunLog, n: number): number {
  const t = tally(log, n);
  const m = Math.max(0, ...t);
  return m === 0 ? -1 : t.indexOf(m);
}

export function makePlan(focus: number): RunPlan {
  if (focus < 0) return { start_segment: 0, repeat_segment: null, extra_cues: false, speech_rate: 1 };
  return { start_segment: Math.max(0, focus - 1), repeat_segment: focus, extra_cues: true, speech_rate: 0.9 };
}

export function scriptedCoach(log: RunLog, n: number): CoachResult {
  const focus = chooseFocus(log, n);
  const line = focus < 0 ? "No mistakes this time. Run it again at the same pace."
    : `Let's practise stretch ${focus + 1} again. The next run starts at stretch ${Math.max(0, focus - 1) + 1}.`;
  return { plan: makePlan(focus), focus_segment: focus, line, source: "scripted" };
}

/** The engine's RunLog knows "hint" (same weight as hesitate), so the log goes as is. */
export function toWireLog(log: RunLog): RunLog {
  return log;
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function validPlan(p: any): p is RunPlan {
  return !!p && isNum(p.start_segment) && (p.repeat_segment === null || isNum(p.repeat_segment)) &&
    typeof p.extra_cues === "boolean" && isNum(p.speech_rate);
}

type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** POST /api/coach. Resolves null on any failure or bad reply; never throws. */
export async function fetchCoach(log: RunLog, buildingId: string, n: number, f: Fetch = fetch as any,
  timeoutMs = 12000): Promise<CoachResult | null> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await f("/api/coach", {
      method: "POST", headers: { "content-type": "application/json" }, signal: ctl?.signal,
      body: JSON.stringify({ ...toWireLog(log), building_id: buildingId }),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    if (!validPlan(j?.plan) || !isNum(j.focus_segment) || typeof j.line !== "string" || j.focus_segment >= n) return null;
    const p = j.plan as RunPlan;
    if (p.start_segment < 0 || p.start_segment >= n || (p.repeat_segment !== null && (p.repeat_segment < 0 || p.repeat_segment >= n))) return null;
    return { plan: p, focus_segment: j.focus_segment, line: j.line.slice(0, 160), source: "agent" };
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
}
