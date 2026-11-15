// BuildingPackage v1 plus v2 additions. Mirror of engine/dr/package.py (CLAUDE.md rule 2).

export type Vec2 = [number, number]; // metres, plan frame
/** 0 free, 1 wall, 2 fixed obstacle, 3 movable obstacle, 4 glass, 5 stairs/drop */
export type CellCode = 0 | 1 | 2 | 3 | 4 | 5;

export interface Grid {
  res: number;
  width: number;
  height: number;
  origin: Vec2;
  cells_b64: string; // uint8 row major, row 0 = lowest y
}

export interface Room { id: string; label: string; polygon: Vec2[]; area_m2: number; scanned?: boolean; }

export interface Door { id: string; a: Vec2; b: Vec2; rooms: [string, string] | []; }

export type LandmarkKind = "desk" | "elevator" | "stairs" | "door" | "glass_door" | "seating" |
  "restroom" | "sign" | "pillar" | "water" | "other";

export interface Landmark {
  id: string; kind: LandmarkKind; label: string; pos: Vec2; confidence: number; fixed: boolean;
}

export interface Entrance { id: string; label: string; pos: Vec2; heading_deg: number; }

export type Side = "left" | "right" | "none";

export interface Segment {
  id: string; start: Vec2; end: Vec2; heading_deg: number; length_m: number; steps: number;
  wall_side: Side; open_m: number; landmarks_passed: string[]; turn_after: Side; turn_deg: number;
  instruction: string;
}

export interface ScoreParts {
  length_m: number; wall_share: number; open_m: number; turns: number; decisions: number;
  hazards: number; landmarks_per_10m: number;
}

export interface Score { total: number; parts: ScoreParts; }

export interface Route {
  id: string; from: string; to: string; path: Vec2[]; segments: Segment[]; score: Score;
}

export interface SimResult { runs: number; arrival_rate: number; lost_cells_b64: string; }

export interface Arrival {
  lat: number; lon: number; entrance_side: string; dropoff: Vec2; driver_message: string;
  image_url: string | null; confirmed: boolean;
  curb_to_door_m: number | null;
  dropoff_plan: Vec2 | null; // curb pin in plan metres
}

export type Source = "matterport" | "vexcel" | "costar" | "hand" | "calc" | "ai";

export interface Prov { src: Source; ref: string; at: string; inputs?: string[] | null; confidence?: number | null; }

export interface GeoAnchor { lat: number; lon: number; plan_pos: Vec2; plan_north_deg: number; }

export interface Frames {
  plan_from_matterport: number[] | null; // 3x3 2D affine, row major
  geo_anchor: GeoAnchor | null;
}

export interface BuildingPackage {
  version: 1;
  id: string;
  name: string;
  source: "matterport" | "fixture";
  model_id: string | null;
  generated_at: string;
  grid: Grid;
  rooms: Room[];
  doors: Door[];
  landmarks: Landmark[];
  entrances: Entrance[];
  routes: Route[];
  sim: Record<string, SimResult>;
  arrival: Arrival | null;
  notes: string[];
  // v2
  prov: Record<string, Prov>;
  frames: Frames;
  map_date: string;
}

// RunLog, RunPlan, PointResult (ruling R3). Engine mirror: engine/dr/package.py (Task 10 engine side).
export type RunLogKind = "start" | "advance" | "off_route" | "bump" | "hesitate" | "hint" | "arrive";

export interface RunEvent { t: number; seg: number; kind: RunLogKind; pos: Vec2; }

export interface QuizEntry { q: string; seg: number; correct: boolean; }

export interface PointResult {
  at: Vec2; target: string; heading: number; target_bearing: number; error_deg: number; time_s: number;
}

/** Identified by thread_id + route_id; building_id goes in the /api/coach request body only. */
export interface RunLog {
  thread_id: string;
  route_id: string;
  events: RunEvent[];
  quiz: QuizEntry[];
  point: PointResult[];
}

export interface RunPlan {
  start_segment: number;
  repeat_segment: number | null;
  extra_cues: boolean;
  speech_rate: number;
}
