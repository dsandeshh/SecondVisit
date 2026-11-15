// Observer protocol v1 (review/agent3_experience.md 4.2). One way: rehearsal -> observer.
// ponytail: web/src/types.ts did not exist when this was written (stream C, Task 8/9). These local
// types mirror engine/dr/package.py field names; swap to `import ... from "../types"` once it lands.
export type Vec2 = [number, number];
export type CellCode = 0 | 1 | 2 | 3 | 4 | 5;
export type RunLogKind = string; // Task 9 RunLog event kinds ("hesitate", "bump", "off_route", ...)
export interface RunPlan { focus_segment?: number; [k: string]: unknown }

export interface Grid { res: number; width: number; height: number; origin: Vec2; cells_b64: string }
export interface Room { id: string; label: string; polygon: Vec2[]; area_m2: number }
export interface Landmark { id: string; kind: string; label: string; pos: Vec2; confidence: number; fixed: boolean }
export interface Segment { id: string; start: Vec2; end: Vec2; heading_deg: number; length_m: number; steps: number; instruction: string }
export interface Route { id: string; from: string; to: string; path: Vec2[]; segments: Segment[] }
export interface PackageLite { id: string; name: string; grid: Grid; rooms: Room[]; landmarks: Landmark[]; routes: Route[] }

export interface EndMsg {
  v: 1; t: "end"; ts: number; run: number; arrived: boolean; time_s: number; bumps: number;
  off_route: number; quiz_correct: number; quiz_total: number; point_error_deg: number | null;
}
export type ObsMsg =
  | { v: 1; t: "hello"; session: string; building_id: string; route_id: string; run: number; mode: string }
  | { v: 1; t: "pose"; ts: number; pos: Vec2; heading: number; cane_deg: number }
  | { v: 1; t: "tap"; ts: number; at: Vec2; code: CellCode }
  | { v: 1; t: "say"; ts: number; text: string; pri: 0 | 1 | 2 | 3 }
  | { v: 1; t: "event"; ts: number; kind: RunLogKind | "hint"; seg: number; pos: Vec2 }
  | { v: 1; t: "quiz"; ts: number; q: string; seg: number; correct: boolean }
  | { v: 1; t: "point"; ts: number; from: Vec2; heading: number; target_bearing: number; error_deg: number }
  | { v: 1; t: "plan"; ts: number; focus_segment: number; line: string; plan: RunPlan }
  | EndMsg;

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const pair = (x: unknown): boolean => Array.isArray(x) && x.length === 2 && fin(x[0]) && fin(x[1]);
const str = (x: unknown): x is string => typeof x === "string" && x.length < 1024;

/** Minimal shape check; the relay is unauthenticated so every peer message is untrusted. */
export function validMsg(m: unknown): m is ObsMsg {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (o.t === "hello") return str(o.session) && str(o.building_id) && str(o.route_id) && fin(o.run) && str(o.mode);
  if (!fin(o.ts)) return false;
  switch (o.t) {
    case "pose": return pair(o.pos) && fin(o.heading) && fin(o.cane_deg);
    case "tap": return pair(o.at) && fin(o.code) && o.code >= 0 && o.code <= 5;
    case "say": return str(o.text) && fin(o.pri);
    case "event": return str(o.kind) && fin(o.seg) && pair(o.pos);
    case "quiz": return str(o.q) && fin(o.seg) && typeof o.correct === "boolean";
    case "point": return pair(o.from) && fin(o.heading) && fin(o.target_bearing) && fin(o.error_deg);
    case "plan": return fin(o.focus_segment) && str(o.line) && typeof o.plan === "object" && o.plan !== null;
    case "end": return fin(o.run) && typeof o.arrived === "boolean" && fin(o.time_s) && fin(o.bumps) && fin(o.off_route) &&
      fin(o.quiz_correct) && fin(o.quiz_total) && (o.point_error_deg === null || fin(o.point_error_deg));
    default: return false;
  }
}
