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
