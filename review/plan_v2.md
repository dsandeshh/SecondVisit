# SecondVisit Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A blindfolded judge rehearses the JRR route from the entrance to a destination desk by sound, passes a quiz, and then a venue view shows a better reception position with before and after numbers, all from one BuildingPackage.

**Architecture:** A Python engine turns a Matterport mesh (or a traced floor plan when the mesh is unavailable) into a 10 cm occupancy grid, plans a cane friendly route, splits it into spoken segments, scores it, simulates travellers, and searches layouts. It writes one `package.json` per building. A TypeScript web app loads that package and runs the audio rehearsal entirely in the browser. A small FastAPI server exposes the agent loops (coach, layout advisor, orchestrator) that call Claude.

**Tech Stack:** Python 3.11 (numpy, scipy, trimesh, shapely, pydantic v2, fastapi, anthropic, httpx, pytest), Vite + TypeScript + vitest, Web Audio API (ConvolverNode, PannerNode HRTF), Web Speech API.

**Spec:** `docs/DRESS_REHEARSAL.md` (the product is now named SecondVisit; tagline "Make your first visit your second."). Background research for every v2 change is in `review/agent1_langchain.md` to `review/agent4_pitch.md`.

## Changes from the spec (decided for a 15 hour build)

1. Phases run in parallel by four people against the shared contract below, not one gate at a time.
2. A **traced map fallback** (Task 3) exists from the start. Matterport meshes are purchased MatterPak assets that must be unlocked, and the overview docs do not list rooms or door openings, so Phase 0 may come back empty for JRR.
3. **Landmarks** are placed by hand in the trace tool for JRR. Vision labelling (C3) runs only if the mesh is available, because placing a label by ray cast needs the mesh.
4. **Coach (C9) moves up** to the rehearsal phase. It is the Amazon track story.
5. **Arrival (C11)** is reduced to one Vexcel image with a confirmed entrance pin and a driver message.
6. **Layout advisor (C7)** does reception placement and two fixes (tactile strip, seating edge). Room assignment is cut.
7. **Demo order flips:** visitor first, venue second.
8. Agents run on LangChain Deep Agents (`create_deep_agent`): one orchestrator with four subagents (site_investigator, route_planner, coach, layout_advisor). Every subagent tool wraps a deterministic `dr.*` function; numbers live in a per thread Workspace and in code written files, never in model text. A scripted pipeline that calls the same tool functions in fixed order is the fallback when the model API fails, and the UI labels it "scripted". **LangChain gate: if the orchestrator plus coach and layout subagents are not producing a live trace by 00:30, drop the LangChain track and ship the scripted path.**
9. Matterport room boundaries, door openings and defurnished panoramas are treated as unavailable (Property Insights is Enterprise only; defurnish exists only where a defurnished view was made). Doors and fixed vs movable come from the trace.
10. **Two demo buildings with distinct roles.** JRR (traced by hand) carries the blindfold run and the real walk. One kit building (Houston or LA) runs the live chain: name, CoStar, suite, Matterport sweep graph and tags, Vexcel. Pitch line: "JRR took us 40 minutes to trace by hand; that cost is why rehearsal never spread. Nobody on our team has visited the Houston building."
11. **Mesh is optional.** The kit building's geometry comes from the Matterport sweep graph plus a floorplan screenshot traced in the Matterport frame (Task 2a). Task 2 runs only if a MatterPak is already unlocked.
12. **Every fact carries provenance** (`prov` in the package), shown as chips and spoken on request (Task 19).
13. **Venue ranking of listings is two part:** arrival score for every available listing, interior score only where a scan exists. No invented interior numbers.
14. **Pointing task** replaces the destination clock hour quiz question. After each run the user is put back at the entrance and turns to face the destination; angular error is the headline learning number (random pointing averages 90 degrees). Run 1 vs run 2 error is the adaptive story.
15. **Observer view** (Task 17) mirrors the rehearsal live onto the projector for sighted judges.
16. **Two output modes:** "app voice" (our speech, transcript not live) and "my screen reader" (no speech, live region only). On phones, swipes are replaced by a full screen Step button plus Repeat, Where am I and Recentre, because screen readers capture swipes. No destination beacon in Rehearse.
17. **Demo safety and framing:** the judge stays seated with a sleep mask; nobody walks blindfolded; the real walk is done sighted or by pointing on a printed plan. Never frame it as "experience blindness". Wired closed back headphones only (Bluetooth latency breaks the cane).

## Global Constraints

- `STEP_M = 0.7`, `CANE_M = 1.2`, `GRID_RES = 0.1`, `WALL_TRAIL_M = 0.6`, `ARRIVE_M = 1.5` (CLAUDE.md rule 4).
- Clock direction: `hour = round(rel_deg / 30) mod 12`, with 0 shown as 12. `rel_deg` is target bearing minus traveller heading, wrapped to (-180, 180].
- Instructions use step counts and clock directions. No feet, no seconds.
- Low confidence landmarks (confidence < 0.6) are spoken with "possibly".
- Every spoken number must equal a field in the package. Validator enforced (Task 6).
- The model id comes from env `DR_MODEL`. Code never hard codes a model string.
- Product copy never claims to replace a cane, guide dog, mobility training, or a compliance audit.
- `DR_MODEL` (orchestrator) and `DR_FAST_MODEL` (subagents) may be a bare Anthropic id or `provider:model`; `model_from_env` adds `anthropic:` to a bare id and builds `ChatAnthropic(timeout=25, max_retries=1)`.
- `write_todos` is opt in since deepagents 0.7.0: pass `TodoListMiddleware()` in `middleware=`. The auto added `general-purpose` subagent and the `execute`, `glob`, `grep` tools are disabled, so the orchestrator can only delegate to our four.
- Any sentence a model writes that reaches a user passes `grounded(text, ws, scope)`: every number in it must appear in the scoped Workspace results, else the template sentence is used.
- Engine deps add `deepagents>=0.7.38,<0.8`, `langchain-anthropic>=1.7`, `langsmith`, `uvicorn[standard]`.
- Every simulated number on screen carries a "simulated" label; every assumed weight carries an "assumed" chip; every rehearsal states its map date and source.

## Review Focus

1. **Orientation permission denied or unavailable (iOS, desktop).** The app must fall back to keyboard and touch controls and say so, never freeze. Test in Task 8.
2. **Speech pile up when the user moves fast.** A new instruction cancels the queued one; at most one utterance plays. Test in Task 8.
3. **No route exists** (scan noise closed a door gap). Planner raises `NoRouteError` naming start and goal; the CLI hint and the agent's retry ladder lower `clearance_m` from 0.35 to no less than 0.25 and raise `drop_specks_m2` to 0.10 (removes small blocked blobs, never wall components). A relaxed route is labelled `relaxed` in the dossier and the UI. `--close-gaps` is only for filling glass holes. The UI says "No route found" if the ladder fails. Test in Task 4.
4. **Audio context not started** before a gesture. Nothing plays until Start is pressed; Start is the only focusable element on first load. Test in Task 8.
5. **Traveller pushes into a wall or off the grid.** Position is clamped, a tap plays, no NaN reaches the audio graph. Test in Task 8.
6. **Double speech with a screen reader.** In screen reader mode `speechSynthesis.speak` is never called; in app voice mode the transcript is not live. Test in Task 8.
7. **Focus lost on the demo laptop** (clicking the observer window). Window blur pauses and says "Paused. Focus lost." Test in Task 8.
8. **Interrupted audio on iPhone.** Lock and unlock resumes after one tap with a spoken prompt. Manual check in Task 16.
9. **Left and right swapped.** `azimuth east is right` test plus an ear check at Start. Test in Task 8.
10. **Model API down or slow mid demo.** Scripted fallback emits the same SSE events labelled "scripted"; recorded traces replay labelled "replay"; the coach never blocks the next run. Test in Task 13.

---

## Shared contract: BuildingPackage v1

`engine/dr/package.py` (pydantic) and `web/src/types.ts` implement exactly this.

```ts
type Vec2 = [number, number];                       // metres, plan frame
type CellCode = 0|1|2|3|4|5;                        // 0 free, 1 wall, 2 fixed obstacle,
                                                    // 3 movable obstacle, 4 glass, 5 stairs/drop
interface Grid { res: number; width: number; height: number; origin: Vec2;
                 cells_b64: string; }               // uint8 row major, row 0 = lowest y
interface Room { id: string; label: string; polygon: Vec2[]; area_m2: number; }
interface Door { id: string; a: Vec2; b: Vec2; rooms: [string, string] | []; }
type LandmarkKind = "desk"|"elevator"|"stairs"|"door"|"glass_door"|"seating"|
                    "restroom"|"sign"|"pillar"|"water"|"other";
interface Landmark { id: string; kind: LandmarkKind; label: string; pos: Vec2;
                     confidence: number; fixed: boolean; }
interface Entrance { id: string; label: string; pos: Vec2; heading_deg: number; }
type Side = "left"|"right"|"none";
interface Segment { id: string; start: Vec2; end: Vec2; heading_deg: number;
                    length_m: number; steps: number; wall_side: Side;
                    open_m: number; landmarks_passed: string[];
                    turn_after: Side; turn_deg: number; instruction: string; }
interface ScoreParts { length_m: number; wall_share: number; open_m: number; turns: number;
                       decisions: number; hazards: number; landmarks_per_10m: number; }
interface Route { id: string; from: string; to: string; path: Vec2[];
                  segments: Segment[]; score: { total: number; parts: ScoreParts }; }
interface SimResult { runs: number; arrival_rate: number; lost_cells_b64: string; }
interface Arrival { lat: number; lon: number; entrance_side: string; dropoff: [number, number];
                    driver_message: string; image_url: string | null; confirmed: boolean; }
interface BuildingPackage { version: 1; id: string; name: string;
  source: "matterport"|"traced"; model_id: string | null; generated_at: string;
  grid: Grid; rooms: Room[]; doors: Door[]; landmarks: Landmark[]; entrances: Entrance[];
  routes: Route[]; sim: Record<string, SimResult>; arrival: Arrival | null; notes: string[]; }
```

`from` and `to` are ids of an Entrance or a Landmark. `sim` is keyed by route id.

**v2 additions (optional fields, defaults keep Task 1 tests green):**
```ts
type Source = "matterport"|"vexcel"|"costar"|"hand"|"calc"|"ai";
interface Prov { src: Source; ref: string; at: string; inputs?: string[]; confidence?: number; }
// BuildingPackage gains:
//   prov: Record<string, Prov>   // default {}; key = fact id, e.g. "landmark:desk",
//                                //   "segment:s2.steps", "arrival.entrance_side", "resolver.suite"
//   frames: { plan_from_matterport: number[] | null;   // 3x3 2D affine, row major
//             geo_anchor: { lat: number; lon: number; plan_pos: Vec2; plan_north_deg: number } | null }
//   map_date: string                                   // ISO date of the scan or trace
// source gains "matterport_sweeps".
```
`RunLog` (Task 9) gains event kind `"hint"` (coach weight 1.0, same as hesitate) and optional `point: PointResult[]` (Task 10). D widens the pydantic Literal for `kind` in the same commit C starts sending `hint`; until then C maps `hint` to `hesitate`.

---

## Priorities and timeline (v2, Saturday 20:30 to Sunday morning)

**P0, the demo fails without it:** Tasks 1, 3 (JRR trace), 4, 5, 6, 7, 8, 9, 10 (with pointing), 13 (or its scripted fallback), 16, 17 (observer view).
**P1, wins the sponsor tracks:** Tasks 0, 2a, 11, 12, 14, 15, 19.
**P2, only if ahead:** Task 2 (mesh), Task 18 (Showcase sync), Optional H.

| Time | A: Data | B: Spatial | C: Experience | D: Agents and layout |
|---|---|---|---|---|
| 20:30 to 21:00 | Ask mentors (Task 0 step 0) | Task 1 | Task 8 P0 items on fixture | Task 3 trace tool |
| 21:00 to 23:00 | Task 0 probe, Task 14 | Tasks 4, 5, 7 | Task 8, Task 9 | Task 6; trace JRR on foot |
| 23:00 to 01:00 | Task 2a, Task 15 | Task 17 observer view | Task 10 web (quiz, pointing) | Task 10 engine, Task 13 (gate at 00:30) |
| 01:00 to 03:00 | Task 19 provenance; Task 18 if production key | Task 11 | Task 19 chips, polish | Task 12 |
| 03:00 to 05:00 | Two blindfold test runs, record traces | Fixes | Fixes | Record agent traces for replay; pitch rehearsal |
| 05:00 freeze | Refresh Vexcel token; backup video by 06:00; Devpost | | | Pitch |

---

### Task 0: Data probe (A, 60 min, starts 20:30)

**Files:** Create `engine/dr/probe.py`, `docs/DATA_STATUS.md`

**Interfaces:** Produces `docs/DATA_STATUS.md` with one row per layer and building (available yes or no, endpoint, sample fields, files under `data/raw/`), ending with `JRR_SOURCE=traced` and `KIT_SOURCE=matterport|matterport_sweeps`.

- [ ] **Step 0 (mentors, 15 min):** CoStar mentor: is our Matterport token sandbox only (sandbox sees only demo models)? Which kit models are public facing or medical? Does the CoStar kit have tenant, floor and suite fields, or only homes for sale? Vexcel mentor: the v2 call to crop one oblique image by point and direction, and whether Princeton has obliques.
- [ ] **Step 1:** `python -m dr.probe --matterport <kit_model_id>` saves raw JSON for: `locations { id position floor { id sequence } room { id label } neighbors panos { skybox(resolution: "2k") { children } } }`, `floors { id label sequence }`, `rooms { id label tags }`, `mattertags { id label position floor { id } }`, `assets { floorplans { url origin { x y } resolution width height floor { sequence } } }`, `bundles { id availability }`, `geolocation`, `address`, `views(types: ["matterport.model.defurnished"]) { id }`, and separately `rooms { boundary }` (expect a permission error: Property Insights is Enterprise only). Signed URLs expire, so download panoramas immediately.
- [ ] **Step 2:** Vexcel v2 only (v1 was deprecated in July 2026): `/auth/login`, then `/oriented/collections?wkt=POINT(lon lat)&srid=4326&layer=urban-g` at JRR (phone GPS at the chosen door) and at the kit building. Record whether obliques exist. Tokens last 24 h (MCP tokens 12 h).
- [ ] **Step 3:** CoStar: one tenant search, one property, one availability query; record which fields exist (floor, suite, co tenants, any Matterport link).
- [ ] **Step 4:** Write `docs/DATA_STATUS.md`. Commit.

### Task 1: Package model, grid helpers, fixture (B, 45 min)

**Files:** Create `engine/dr/config.py`, `engine/dr/package.py`, `engine/dr/grid.py`, `engine/dr/fixtures.py`, `engine/tests/test_grid.py`

**Interfaces:**
- Produces: `class BuildingPackage(BaseModel)` and all sub models from the shared contract.
- Produces: `class OccGrid` with `res, origin, cells: np.ndarray[uint8]`, `world_to_cell(p: Vec2) -> tuple[int,int]`, `cell_to_world(rc) -> Vec2`, `to_b64() -> str`, `from_b64(s, width, height, res, origin) -> OccGrid`, `wall_distance() -> np.ndarray` (metres to nearest code 1, 2 or 4, via `scipy.ndimage.distance_transform_edt`).
- Produces: `lobby_fixture() -> OccGrid, list[Entrance], list[Landmark]`: a 20 m by 12 m room, 0.2 m walls, a 1.2 m gap in the west wall at y 5.4 to 6.6, entrance `ent_w` at (0.5, 6.0) heading 90, landmark `desk` (kind desk) at (18.5, 10.8), one pillar obstacle 1 m square centred at (10, 6).

- [ ] **Step 1: Failing tests** `test_b64_roundtrip` (encode then decode equals original), `test_world_cell_roundtrip` (cell_to_world(world_to_cell(p)) within res/2 of p), `test_wall_distance` (lobby point (3, 3) is 2.8 ± 0.15 m from the nearest wall face; the pillar is farther).
- [ ] **Step 2:** `pytest tests/test_grid.py -v` fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass. Commit.

### Task 2: Mesh slice to grid (B, 90 min, only if JRR_SOURCE=matterport or for the sponsor city building)

**Files:** Create `engine/dr/mesh_slice.py`, `engine/tests/test_mesh_slice.py`

**Interfaces:**
- Consumes: `OccGrid` (Task 1).
- Produces: `slice_mesh(path: str, floor_z: float | None = None, z_lo=0.1, z_hi=1.8, res=GRID_RES, close_gaps_m=0.0) -> OccGrid`. Floor z auto detected as the most common low z of upward facing triangles. Cells crossed by any section in [z_lo, z_hi] (sample every 0.1 m) become 1; enclosed small blobs under 1.5 m² become 2. Optional morphological closing by `close_gaps_m`.

- [ ] **Step 1: Failing test** `test_box_room_with_door`: build a trimesh of a 10 m by 6 m room with 0.2 m thick walls 2.5 m high and a 1.0 m door gap in the south wall at x 4.5 to 5.5. Assert cells along the north wall are 1, the door gap cell at (5.0, 0.1) is 0, the room centre is 0.
- [ ] **Step 2:** Fails. **Step 3:** Implement with `trimesh.Trimesh.section_multiplane` and `shapely` rasterisation. **Step 4:** Passes. Commit.
- [ ] **Step 5:** Run on the real OBJ, write `data/<id>/grid_preview.png`, eyeball against the floor plan. Note mirror and glass holes in `docs/DATA_STATUS.md`.

### Task 2a: Sweep graph and Matterport floorplan import (A, 60 min, then D 45 min tracing)

**Files:** Create `engine/dr/mp_sweeps.py`, `engine/tests/test_mp_sweeps.py`

**Interfaces:**
- Produces `load_sweeps(raw_json_path) -> SweepGraph` with `nodes: dict[id, {pos: Vec2, z: float, floor: int, room: str|None}]`, `edges: set[tuple[id, id]]` from `neighbors` (symmetrised), axis swap applied from `frames`.
- Produces `sweep_landmarks(raw) -> list[Landmark]` from Mattertags (kind guessed from the label by keyword, confidence 0.8, `prov.src = "matterport"`).
- Produces `floorplan_scale(screens: dict[id, Vec2px], world: dict[id, Vec2]) -> (m_per_px, origin)` from two or more sweeps for the trace tool.
- [ ] **Step 1: Failing tests** `test_neighbors_symmetric`; `test_floor_filter` (only sweeps with the requested floor sequence); `test_scale_from_two_sweeps` (two sweeps 10 m apart, 500 px apart, gives 0.02 m per px).
- [ ] **Step 2 to 4.** Fail, implement, pass. Commit.
- [ ] **Step 5:** D traces the floorplan screenshot with the computed scale; the resulting `trace.json` is in the Matterport frame.

### Task 3: Trace tool and import (D, 90 min, then 60 min tracing JRR on foot)

**Files:** Create `web/src/trace/trace.ts`, `web/trace.html`, `engine/dr/trace_import.py`, `engine/tests/test_trace_import.py`

**Interfaces:**
- Produces `trace.json`: `{ image: string, scale_m_per_px: number, walls: Vec2[][], glass: Vec2[][], obstacles: Vec2[][] (polygons, with "fixed": bool), doors: Door[], rooms: Room[], landmarks: Landmark[], entrances: Entrance[] }`, all in metres in the plan frame.
- Produces `import_trace(path: str, res=GRID_RES) -> tuple[OccGrid, list[Room], list[Door], list[Landmark], list[Entrance]]`. Walls rasterise as 0.15 m thick code 1, glass code 4, obstacles code 2 or 3.

- [ ] **Step 1: Failing test** `test_rasterise_wall`: a trace with one wall from (0,0) to (5,0) gives code 1 at (2.5, 0) and code 0 at (2.5, 0.5).
- [ ] **Step 2:** Fails. **Step 3:** Implement import. **Step 4:** Passes.
- [ ] **Step 5:** Trace tool: load a floor plan photo, click two points and type their real distance to set scale, then tools for wall, glass, obstacle, door, room, landmark (kind dropdown, confidence fixed 1.0), entrance (click then drag for heading). Keyboard shortcuts W G O D R L E, Z to undo, Export downloads `trace.json`.
- [ ] **Step 6:** Photograph the JRR evacuation plan or floor plan sign, trace the ground floor route area, pace two known distances to check scale. Save `data/jrr/trace.json`. Commit.

### Task 4: Cane friendly planner (B, 90 min)

**Files:** Create `engine/dr/planner.py`, `engine/tests/test_planner.py`

**Interfaces:**
- Consumes: `OccGrid`, `wall_distance()`.
- Produces: `plan(grid: OccGrid, start: Vec2, goal: Vec2, landmarks: list[Landmark], w: Weights = Weights()) -> list[Vec2]` (cell centre path, start to goal). `shortest(grid, start, goal) -> list[Vec2]` (plain A*, same clearance). `class NoRouteError(Exception)`.
- `Weights`: `open=3.0, turn_per_45=2.0, hazard=10.0, landmark_bonus=0.3, clearance_m=0.35`.

Cell cost, before the turn penalty (an algorithm the signature does not determine):
```
d = wall_distance at cell (m); cells with d < clearance_m are blocked
open = clip((d - WALL_TRAIL_M) / 1.5, 0, 1)
hazard = 1 if any code 4 or 5 within 1.0 m else 0
lm = 1 if any landmark within 1.0 m else 0
cost = step_len * max(0.2, 1 + w.open*open + w.hazard*hazard - w.landmark_bonus*lm)
```
Search state is (cell, heading octant) so the turn penalty `w.turn_per_45 * octant_change` is exact. 8 connected moves.

- [ ] **Step 1: Failing tests** on `lobby_fixture()`:
  - `test_reaches_goal`: last point within 0.2 m of the desk approach point (desk pos moved 0.6 m toward free space).
  - `test_follows_walls`: fraction of path points with wall distance ≤ WALL_TRAIL_M + 0.1 is ≥ 0.6.
  - `test_less_open_than_shortest`: metres of path with open > 0.5 is less than half that of `shortest()`.
  - `test_no_route`: wall off the desk with a closed box, `plan` raises `NoRouteError` and the message contains both coordinates.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass (keep JRR scale grids under 2 s; downsample to 0.2 m for search if needed). Commit.

### Task 5: Segments and score (B, 60 min)

**Files:** Create `engine/dr/segments.py`, `engine/dr/score.py`, `engine/tests/test_segments.py`

**Interfaces:**
- Produces: `segment(path: list[Vec2], grid: OccGrid, landmarks: list[Landmark]) -> list[Segment]`. Simplify with Douglas Peucker (tolerance 0.3 m), merge turns under 25 degrees. `steps = max(1, round(length_m / STEP_M))`. `wall_side` is the side where wall distance ≤ WALL_TRAIL_M + 0.1 for ≥ 60 percent of samples, else "none". `landmarks_passed` are landmarks within 1.5 m of the segment. `turn_deg` is the signed change to the next heading (positive = right). `instruction` left as "" for Task 6.
- Produces: `score_route(segments, grid, landmarks) -> {total, parts}`. Decisions are segment ends where the free space branches into three or more directions (sample the 8 rays of 2 m). Total:
```
total = 100 * (0.35*wall_share + 0.20*(1 - min(open_m/20, 1)) + 0.15*(1 - min(turns/10, 1))
             + 0.10*(1 - min(decisions/8, 1)) + 0.10*(1 - min(hazards/3, 1))
             + 0.10*min(landmarks_per_10m/2, 1))
```
- [ ] **Step 1: Failing tests** `test_l_route`: path (0,0) to (0,7) to (5.6,7) gives 2 segments, steps 10 and 8, first turn_after "right", turn_deg 90 ± 5. `test_score_range`: lobby planned route scores higher than lobby shortest route, both in [0, 100].
- [ ] **Step 2 to 4:** Fail, implement, pass. Commit.

### Task 6: Instruction writer (D, 60 min)

**Files:** Create `engine/dr/instructions.py`, `engine/dr/llm.py`, `engine/tests/test_instructions.py`; `web/src/clock.ts` mirrors `clock_hour`.

**Interfaces:**
- Produces: `clock_hour(rel_deg: float) -> int` (1 to 12). `write(segments, landmarks, entrances, smooth: bool = False) -> list[Segment]` filling `instruction`. `numbers_match(text: str, seg: Segment) -> bool`.
- Templates: first segment "Facing into the building. Walk {steps} steps{wall_clause}{landmark_clause}." Others: "Turn {left|right} to {clock} o'clock. Walk {steps} steps{wall_clause}{landmark_clause}." Wall clause ", wall on your {side}". Landmark clause ", passing the {label}" or ", passing possibly the {label}" when confidence < 0.6. Last segment ends ". The {destination label} is at {clock} o'clock, about {n} steps."
- `llm.py`: `complete(system: str, user: str, max_tokens=300) -> str` using `anthropic` with model from `DR_MODEL`; returns "" on any error. Smoothing prompt: "Rewrite for natural speech. Keep every number and every left, right and o'clock exactly." Keep the smoothed text only if `numbers_match` is true, else keep the template.
- [ ] **Step 1: Failing tests** `test_clock`: 0→12, 30→1, 60→2, 90→3, 180→6, -90→9, -30→11, 179→6. `test_numbers_match`: template output for every lobby segment passes; a string with the step count changed fails. `test_smooth_rejects_drift`: monkeypatch `complete` to return text with a wrong number; `write(..., smooth=True)` keeps the template.
- [ ] **Step 2 to 4:** Fail, implement, pass. Commit.

### Task 7: Build CLI (B, 30 min)

**Files:** Create `engine/dr/cli.py`, `engine/tests/test_cli.py`

**Interfaces:**
- Produces: `python -m dr.cli build --source {traced,matterport,fixture} --in PATH --out PATH [--from ID] [--to ID] [--close-gaps M] [--sim N]`. Default from = first entrance, to = first landmark of kind desk. Writes a valid BuildingPackage with one route; runs Task 11 sim if `--sim` and that module exists.
- [ ] **Step 1: Failing test** `test_build_fixture`: build `--source fixture` to a temp path, load with `BuildingPackage.model_validate_json`, route has ≥ 2 segments, every instruction non empty.
- [ ] **Step 2 to 4:** Fail, implement, pass. Generate `web/public/buildings/fixture/package.json` and (once traced) `web/public/buildings/jrr/package.json`. Commit both.

### Task 8: Web world, audio, input, Explore mode (C, 4 h)

**Files:** Create `web/src/{main,types,config,world,clock}.ts`, `web/src/audio/*.ts`, `web/src/input/*.ts`, `web/src/modes/explore.ts`, `web/index.html`, `web/src/*.test.ts`

**Interfaces:**
- Consumes: `BuildingPackage` JSON from `/buildings/<id>/package.json` (`?b=jrr`, default `fixture`).
- Produces: `class World { constructor(pkg); cellAt(p: Vec2): CellCode; raycast(origin: Vec2, deg: number, maxM: number): {dist: number, code: CellCode} | null; roomAt(p): Room | null; }` (step 0.05 m along the ray).
- Produces: `class Traveller { pos: Vec2; heading: number; caneDeg: number; step(dir: 1|-1): "ok"|"bump"; turn(deg: number): void; }` A bump leaves pos unchanged and plays a tap.
- Produces audio: `cane.ts` contact tap (8 ms filtered noise; wall bright, glass higher and with a ring, obstacle duller; louder when closer), `echo.ts` one ConvolverNode with a synthetic impulse whose decay = `0.3 + 0.08 * sqrt(room area)` seconds, footstep click per step, `landmarks.ts` an HRTF PannerNode loop per landmark within 6 m with a distinct timbre per kind, `speech.ts` `say(text, {interrupt: true})` that cancels anything pending and mirrors text to the live region, `haptics.ts` `pulse(ms)` that calls `navigator.vibrate` when present.
- Controls. Keyboard: Up/Down step, Left/Right turn 15 degrees, mouse x or A/D sweeps cane ±50 degrees, Space repeats the current instruction, H says heading as clock relative to the building entrance. Phone: tap lower half to step, swipe left or right to turn 45 degrees, tilting the phone (gamma) sweeps the cane. Orientation is requested only from the Start button; if denied, say "Motion not available. Use taps and swipes." and continue.
- [ ] **Step 1: Failing tests (vitest)** `raycast hits west wall` (fixture, origin (2,6), heading 270, returns dist 1.6 ± 0.1, code 1); `step moves STEP_M`; `bump into wall keeps position and returns bump`; `clamped position never NaN after 200 random steps`; `say interrupts` (mock `speechSynthesis`, two calls, `cancel` called before second `speak`); `start gate` (before Start, `AudioEngine.ctx` is null and Start is the only focusable element); `orientation denied falls back` (mock `requestPermission` rejecting, mode becomes "touch").
- [ ] **Step 2 to 4:** Fail, implement, pass.
- [ ] **Step 5:** Manual check: blindfolded teammate in Explore on the fixture finds the pillar and the desk by sound alone. Commit.

#### v2 amendments (from review/agent3_experience.md, Part B)

**Files:** Modify `web/src/audio/{engine,cane,echo,landmarks,speech,haptics}.ts`, `web/src/input/{keyboard,orientation}.ts`, `web/index.html`. Create `web/src/audio/space.ts`, `web/src/audio/taps.ts`, `web/src/audio/space.test.ts`, `web/src/audio/cane.test.ts`, `web/src/audio/speech.test.ts`.

**Interfaces:**
- `start(): Promise<StartReport>` with `StartReport = { audio: "running"|"failed"; motion: "granted"|"denied"|"unavailable"; vibrate: boolean; latencyMs: number }`, as in section 1.1 of `review/agent3_experience.md`. Spoken status line after Start. `onAudioPaused()` announces and resumes on next gesture.
- `space.ts`: `toAudio(p: Vec2)`, `forwardFor(h: number)`, `azimuth(listener: Vec2, heading: number, src: Vec2): number` (positive right).
- `cane.ts`: `sweepContact(world, origin, heading, fromDeg, toDeg, maxM = CANE_M, stepDeg = 2): {dist, code, caneDeg, at: Vec2} | null` (first contact along the sweep). `class TapGate { update(hit, tMs): TapEvent | null }` (edge triggered, 60 ms gate, 0.3 m new surface rule). `autoSweep(step: number)` arc −30 to +30 alternating.
- `taps.ts`: `renderTaps(ctx): Record<CellCode | "floor" | "bump" | "step", AudioBuffer>` pre rendered at Start.
- `echo.ts`: `impulse(ctx, t60: number): AudioBuffer` (decorrelated stereo, exp envelope, darkening, T60 capped at 2.0), two convolvers with a 300 ms crossfade.
- `landmarks.ts`: `audible(landmarks, pos, heading, opts: {max: 2, radiusM: 6, includeDestination: boolean}): Landmark[]` limited to sounding kinds.
- `speech.ts`: `say(text, pri: 0|1|2|3 = 2)`, `setRate(r)`, `setOutput("app"|"screenreader")`, `prime(text)`. Chooses a `localService` English voice on `voiceschanged`. Splits at sentence ends to at most 160 chars. Keeps utterance references. Treats `canceled` and `interrupted` errors as normal. Ducks beacons and taps while speaking.
- `haptics.ts`: `pulse(ms)` guarded by `"vibrate" in navigator`, minimum 25 ms.
- Master chain: sources, then ducking gains, then channel swap (S) and mono (M), then a limiter, then destination.
- Keyboard: Up step (rate limit 400 ms, auto sweep on), Down step back, Left and Right turn 15 degrees, A/D manual sweep, Space repeat, H heading, W where am I, B destination hint, M mono, S swap, `+`/`-` rate. `preventDefault` on arrows and Space; ignore `e.repeat` except for Up, Down, Left, Right. Window `blur` pauses with "Paused. Focus lost."
- Stage element: `role="application"`, `tabindex="0"`, `aria-label` with the four keys. Transcript region present from load with `aria-live` set by output mode.
- Phone: full screen Step button plus Repeat, Where am I, Recentre buttons; body yaw (relative alpha) turns; gamma sweeps; no swipes.
- Operator panel (hidden behind `?op=1`): latency ms, motion state, output mode, voice name.

- [ ] **Step 1: Failing tests (vitest)** in addition to the planned seven:
  - `azimuth east is right`: listener (0,0) heading 0, source (3,0) gives +90 ± 1; heading 90, source (0,−3) gives +90 ± 1; `toAudio([3,0])[0] > 0` and `forwardFor(0)` is (0,0,−1).
  - `sweep finds thin pillar`: fixture, origin (8.6,6) heading 90 (pillar face 0.9 m ahead; both ±40 degree end rays miss it), sweep from −40 to +40 in one call finds code 2 at caneDeg within ±10 of 0.
  - `tap gate is edge triggered`: the same hit for 10 frames 16 ms apart yields exactly 1 tap; a code change yields a second.
  - `tap gate rate limit`: alternating hit and miss every 10 ms yields at most 1 tap per 60 ms.
  - `speech priority`: speaking a priority 1 line while a priority 2 line is current does not call `cancel` or `speak`; a priority 3 line calls `cancel` then `speak`.
  - `speech splits long text`: a 400 character, 4 sentence string produces at least 3 utterances, each at most 160 chars.
  - `screen reader mode does not speak`: `setOutput("screenreader")`, `say("x")` writes the live region and never calls `speechSynthesis.speak`; in app mode the region has `aria-live="off"`.
  - `voice prefers local`: mocked voices list with a Google network voice first and a local English voice second picks the local one.
  - `vibrate guarded`: with `navigator.vibrate` undefined, `pulse(25)` does not throw.
  - `audible budget`: 8 sounding landmarks within 6 m returns exactly 2, the nearest; the destination is excluded when `includeDestination` is false.
  - `audioSession set`: with a mocked `navigator.audioSession`, `start()` sets `type` to `"playback"` before constructing `AudioContext`.
  - `motion unavailable on desktop`: no orientation event within 1000 ms gives `motion: "unavailable"` and mode `"keys"`.
  - `key repeat throttled`: 30 Up keydowns 33 ms apart produce at most 3 steps.
  - `blur pauses`: dispatching `blur` on window calls `say("Paused. Focus lost.", 3)` and stops the hesitation timer.
- [ ] **Step 2 to 4:** Fail, implement, pass. Order if short of time: start sequence, key throttle, blur pause, speech priority and local voice, auto sweep with interpolation and tap gate, space mapping, then the rest.
- [ ] **Step 5:** Latency measurement by filming key and tap (section 1.8 of `review/agent3_experience.md`). Write the number to `docs/DEMO.md`.
- [ ] **Step 6:** Manual: on an iPhone with the silent switch on, Start, confirm taps and speech both play. On an Android phone, confirm vibration on contact. With VoiceOver on, confirm the Step button walks with a double tap. Commit.

Timebox: P0 items about 2 h on top of what exists; the rest is P1.

### Task 9: Rehearse mode and pocket summary (C, 90 min)

**Files:** Create `web/src/modes/rehearse.ts`, `web/src/modes/summary.ts`, tests.

**Interfaces:**
- Produces: `class RehearsalRun { constructor(route: Route, plan?: RunPlan); current: number; onMove(t: Traveller): Event[]; log: RunLog; }`
- `type RunPlan = { start_segment: number; repeat_segment: number | null; extra_cues: boolean; speech_rate: number }` (Task 10 produces it).
- `type RunLog = { route_id: string; events: { t: number; seg: number; kind: "start"|"advance"|"off_route"|"bump"|"hesitate"|"arrive"; pos: Vec2 }[]; quiz: { q: string; seg: number; correct: boolean }[] }`.
- Rules: speak a segment's instruction on entering it; advance when within 0.8 m of its end; `off_route` when more than 2.0 m from the route path (say "Off route. Wall was on your {side}."); `hesitate` after 5 s without a step; `arrive` within ARRIVE_M of the goal (say "You have reached the {label}."). With `extra_cues`, also speak landmark names on passing.
- Summary: numbered list of instructions, read aloud with Space, and a Copy button.
- [ ] **Step 1: Failing tests** `advance on reaching segment end`; `off_route fires once per excursion`; `arrive ends run`; `plan.start_segment starts there`. **Step 2 to 4.** Commit.

#### v2 amendments

**Interfaces:**
- `RunLog.events[].kind` adds `"hint"` (key B). Weight for the coach: same as `hesitate` (1.0). If D's pydantic RunLog types `kind` as a Literal, an unknown `"hint"` makes `/api/coach` reject the whole log with a 422. So D widens the Literal and adds `hint` to `choose_focus` in the same commit as C starts sending it (contract rule 2 applies to RunLog by analogy; log it in `docs/CHANGELOG.md`). Until then C maps `hint` to `hesitate` before posting.
- `RunLog.point?: { at: Vec2; target: string; heading: number; error_deg: number; time_s: number }[]` (optional, ignored by the coach).
- Hesitation timer counts only while no speech is playing and the audio context is running. Otherwise long instructions look like hesitation and the coach over weights long segments.
- After a hesitation, speak once (priority 0): "Press Space to hear the instruction again." Do not auto repeat.
- Off route with `wall_side === "none"`: "Off route. Press Space to hear the last instruction."
- Open area announcement on entering a segment with `open_m > 3` (section 3.2 of `review/agent3_experience.md`).
- No destination beacon in Rehearse; B gives three chirps and logs `hint`.
- Arrive leads straight into the pointing task (Task 10).
- Pocket summary reads one instruction per utterance.

- [ ] **Step 1: Failing tests** in addition to the planned four: `hesitate not logged while speaking` (mock speech speaking for 6 s, no `hesitate`); `hint logged on B`; `off route with no wall side uses the generic line`; `open area line uses package open_m` (spoken step number equals `round(open_m / STEP_M)`).
- [ ] **Step 2 to 4.** Commit.

### Task 10: Quiz and coach (C web, D engine, 2 h)

**Files:** Create `web/src/modes/quiz.ts`, `engine/dr/agents/coach.py`, `engine/dr/api.py` (route `/api/coach`), tests.

**Interfaces:**
- Web quiz builds 4 questions from the route, spoken with options 1 to 4 (keys or four screen quadrants): steps on a chosen segment; which side the wall is on; which way you turn after a landmark; where the destination is as a clock hour from the last turn. Each carries `seg`. Distractors are other real values from the route.
- `POST /api/coach` body `RunLog` plus `route_id` and `building_id`, returns `{ plan: RunPlan, focus_segment: int, line: string }`.
- `choose_focus(log: RunLog, n_segments: int) -> int` deterministic: per segment, wrong answer 2.0, off_route 1.5, hesitate 1.0, bump 0.5; ties go to the earlier segment; no errors returns -1.
- `make_plan(focus: int) -> RunPlan`: start one segment before focus (min 0), `repeat_segment = focus`, `extra_cues = True`, `speech_rate = 0.9`. Focus -1 gives a plain full run at rate 1.0.
- `coach(log, route) -> dict`: a Claude tool use loop with tools `get_errors()` (returns the per segment tallies) and `set_plan(focus_segment)` (calls `make_plan`, rejects ids out of range). If the model fails or picks a segment whose tally is not the maximum, use `choose_focus`. The model writes `line`, one sentence, for example "Let's practise the turn after the stairs again." If the API is down, `line` comes from a template.
- [ ] **Step 1: Failing tests** `test_focus_on_failed_quiz` (wrong answer on seg 2 only gives focus 2); `test_plan_differs` (plan after a failed quiz differs from the no error plan in start_segment or repeat_segment); `test_coach_fallback` (monkeypatched `complete` raising still returns a valid plan). Web: `quiz questions use real numbers`.
- [ ] **Step 2 to 4.** Commit.

#### v2 amendments, web side: pointing task

**Files:** Create `web/src/modes/point.ts`, `web/src/modes/point.test.ts`. Modify `web/src/modes/quiz.ts`, `engine/dr/agents/coach.py` (accept `hint`).

**Interfaces:**
- `class PointTask { constructor(from: Vec2, startHeading: number, target: Landmark); turn(deg: number): void; confirm(tMs: number): PointResult }`, `PointResult = { at: Vec2; target: string; heading: number; target_bearing: number; error_deg: number; time_s: number }`.
- `bearing(from: Vec2, to: Vec2): number` (0 = +y, clockwise, [0, 360)), `angularError(a: number, b: number): number` in [0, 180].
- Flow after arrive: place at the route's start entrance, heading = `entrance.heading_deg`, say "You are back at the entrance, facing into the building. Turn to face the {target label}, then press Space." Turn step 5 degrees, ratchet tick every 15. Feedback after confirm uses `clock_hour` from `clock.ts`.
- Quiz: 3 of the 4 planned questions (drop the destination clock hour question, which the pointing task replaces), options read aloud, R repeats options, keys 1 to 4 or four stacked buttons on phone. P1: route reversal question built from `segments[last]` reversed (`wall_side` flips).
- Point results go to `RunLog.point` and to the observer as `point` messages. Run 2 also ends with a pointing task.

- [ ] **Step 1: Failing tests** `angularError wraps` (350 vs 10 gives 20; 0 vs 180 gives 180); `bearing east is 90` ((0,0) to (5,0)); `point task error` (fixture entrance (0.5, 6.0) heading 90, desk (18.5, 10.8), turning to the exact bearing then confirm gives error under 3); `no feedback before confirm` (no `say` call containing "degrees" before `confirm`); `quiz has 3 questions plus pointing`; engine: `test_hint_counts_like_hesitate`.
- [ ] **Step 2 to 4.** Commit.

#### v2 replacement, engine side: coach rules and the deep agent coach (supersedes the coach bullets above)

**Files:** Create `engine/dr/coach_rules.py`, `engine/tests/test_coach_rules.py`. `engine/dr/agents/coach.py`
becomes a 30 line wrapper. Route `/api/coach` in `api.py` stays for the web half (same response shape).

**Interfaces:**
- `tally(log: RunLog, n_segments: int) -> list[float]`: per segment, wrong answer 2.0, off_route 1.5,
  hesitate 1.0, bump 0.5.
- `choose_focus(log, n_segments) -> int`: argmax of `tally`, ties to the earlier segment, -1 if all zero.
- `make_plan(focus: int, drill: Literal["repeat","approach","slow"] = "repeat") -> RunPlan`.
  repeat: start one segment before focus (min 0), `repeat_segment=focus`, `extra_cues=True`, `speech_rate=0.9`.
  approach: same but start two segments before. slow: as repeat with `speech_rate=0.8`.
  Focus -1: plain full run at rate 1.0 (unchanged from the plan).
- Coach subagent tools (in `dr/agents/deep_agent.py`): `get_errors(run_log_id, route_id)` and
  `set_plan(run_log_id, route_id, focus_segment, drill, line)`. `set_plan` overrides a focus whose tally is
  below the maximum, maps an unknown drill to repeat, and replaces `line` with a template if it is empty,
  over 160 characters, or has a number not in the focus segment. Writes `/rehearsal/rehearsal_plan.json`.
  The model chooses the drill from the error kinds and writes `/coach_notes.md`.
- `coach(log, route) -> {plan, focus_segment, line}` (unchanged signature): returns the deterministic
  `make_plan(choose_focus(...))` immediately if the agent is off; else runs the deep agent with a 12 s
  timeout on the coach path and falls back to the deterministic plan and a template line.
- The web starts the next run with the deterministic plan straight away and swaps in the agent's plan
  only if it arrives before the user presses Start. Nobody waits on the model.

- [ ] **Step 1: Failing tests** `test_focus_on_failed_quiz` (wrong answer on seg 2 only gives focus 2);
  `test_plan_differs`; `test_approach_starts_two_earlier`; `test_set_plan_overrides_non_max_focus`;
  `test_coach_line_with_invented_number_is_replaced`; `test_coach_fallback` (agent raising still returns a
  valid plan). The last three exist in `test_deep_agent.py`.
- [ ] **Step 2:** `pytest tests/test_coach_rules.py tests/test_deep_agent.py -q` fails.
- [ ] **Step 3:** Implement `coach_rules.py`; point `DrEngine.tally` and `DrEngine.make_plan` at it.
- [ ] **Step 4:** Pass. Commit `feat(coach): drills and deep agent coach`.

### Task 11: Simulated traveller (B, 2 h)

**Files:** Create `engine/dr/simulate.py`, `engine/tests/test_simulate.py`

**Interfaces:**
- Produces: `simulate(grid, route: Route, runs=300, seed=0, err: ErrorModel = ErrorModel()) -> SimResult`.
- `ErrorModel`: `step_sd=0.08` (m), `heading_bias_sd=6` (deg per segment), `heading_noise_sd=3` (deg per step), `count_sd_frac=0.12` (fraction of steps miscounted), `vague_count_sd_frac=0.35` (used when a segment's instruction has no step number).
- Each agent walks each segment: draws a bias, takes `steps * (1 + N(0, count_sd))` steps with noise; within CANE_M of the stated wall side it corrects heading toward a 0.5 m offset; a bump stops forward motion for that step; at a segment end it turns by `turn_deg + N(0, 10)`. Lost if more than 3.0 m from the path at any point; success if within ARRIVE_M of the goal at the end. Lost positions accumulate into a grid encoded as `lost_cells_b64`.
- [ ] **Step 1: Failing tests** `test_deterministic` (same seed gives same rate); `test_vague_lowers_arrival` (removing the step number from segment 2's instruction lowers arrival rate by at least 15 points, 300 runs, seed 0); `test_lost_heatmap_peaks_near_vague_segment`.
- [ ] **Step 2 to 4.** Hook into the CLI `--sim`. Commit.

### Task 12: Layout advisor and venue view (D engine, C or D web, 3 h)

**Files:** Create `engine/dr/layout.py`, `engine/dr/agents/layout_agent.py`, route `/api/layout` in `api.py`, `web/src/venue/venue.ts`, `web/venue.html`, tests.

**Interfaces:**
- `candidates(grid, entrances, n=40) -> list[Vec2]`: free cells with a wall within 0.8 m, at least 1.2 m from any door, at least 1.5 m clear in front.
- `evaluate(grid, entrances, desk: Vec2, fixes: list[Fix] = []) -> {score: float, arrival_rate: float, route: Route}`: plan and score from every entrance (mean), simulate 100 runs.
- `Fix = {kind: "tactile_strip", path: Vec2[]} | {kind: "seating_edge", path: Vec2[]}`. A tactile strip counts as a trailable edge (cells along it get `open = 0` in the planner via an override mask). A seating edge adds a code 3 line.
- `advise(pkg, current_desk_id) -> Report` where `Report = {current: Eval, best: Eval, best_pos: Vec2, fixes: list[Fix], rounds: list[{proposal, result, critique}]}`. Loop up to 3 rounds: code ranks the top 5 candidates; the model sees their numbers and may propose one fix (as a polyline between two named landmarks or walls, which code converts) and a short critique; code evaluates; keep the best. All numbers in the report come from code.
- Venue view: canvas plan (grid shaded by code), current route in grey, lost heatmap in red, proposed desk and route in green, a before and after table (score, arrival rate, open metres, turns), the agent rounds as a readable log.
- [ ] **Step 1: Failing tests** `test_candidates_keep_doors_clear`; `test_advise_improves_fixture` (with the fixture desk moved to the middle of the room at (10, 9), `best.score > current.score` and `best.arrival_rate >= current.arrival_rate`); `test_report_numbers_from_code` (monkeypatched model text with invented numbers never reaches `Report` numeric fields).
- [ ] **Step 2 to 4.** Commit.

#### v2 replacement, agent loop part (supersedes the `advise` loop and `layout_agent.py` above)

`engine/dr/layout.py` (`candidates`, `evaluate`, `Fix`) and the venue view are unchanged.

**Files:** Delete `engine/dr/agents/layout_agent.py` from the plan. The loop is the `layout_advisor`
subagent in `engine/dr/agents/deep_agent.py`. Keep a deterministic `advise(pkg, current_desk_id) -> Report`
in `layout.py` (top 3 candidates, no fixes) for the scripted fallback and for `test_advise_improves_fixture`.

**Interfaces:**
- Tools: `layout_candidates(building_id, desk_id, n=5)` (code ranks; also evaluates the current desk once),
  `evaluate_layout(building_id, candidate_id, fixes=[{kind, from_id, to_id}])` (code converts landmark ids to
  a polyline with `fix_between`, simulates 100 runs, returns score, arrival rate and lost hotspots tied to a
  segment and nearest landmark), `record_round(eval_id, proposal, critique)` (writes `/venue/layout_report.md`).
- `ToolCallLimitMiddleware(tool_name="evaluate_layout", run_limit=6)` on the subagent bounds the loop.
- `Report` for the venue view comes from `assemble_result(..., kind="layout")`: `current`, `best` (max of
  score then arrival rate over every eval), `rounds`. All numeric fields from the Workspace.
- `/api/layout` becomes `POST /api/agent` with the venue text; the venue view renders the SSE trace on the
  left and the report on `final`.

- [ ] **Step 1: Failing tests** `test_candidates_keep_doors_clear`, `test_advise_improves_fixture` (as before,
  on deterministic `advise`); `test_layout_round_strips_invented_numbers_and_tracks_best` and
  `test_scripted_fallback_visitor_and_venue` (in `test_deep_agent.py`).
- [ ] **Step 2 to 4.** Commit `feat(layout): deep agent propose simulate critique loop`.

### Task 13: Orchestrator on Deep Agents (D, 2 h, LangChain gate at 00:30)

**Files:** Create `engine/dr/agents/deep_agent.py`, `engine/dr/agents/api_stream.py`,
`engine/tests/test_deep_agent.py` (start from the review skeletons in `review/langchain/`),
`web/src/trace/panel.ts`, mount the router in `engine/dr/api.py`, add the input box to the home screen.

**Interfaces:**
- `build_agent(model=None, sub_model=None, checkpointer=None) -> CompiledStateGraph`:
  `create_deep_agent(model, tools=[ask_visitor, finalize], system_prompt=ORCHESTRATOR_PROMPT,
  subagents=[site_investigator, route_planner, coach, layout_advisor],
  middleware=[TodoListMiddleware(), ModelCallLimitMiddleware(run_limit=14, exit_behavior="end")],
  checkpointer=InMemorySaver())`.
- `ask_visitor(question, option_ids)` calls LangGraph `interrupt()`; the API turns it into a `question` SSE
  event and `POST /api/agent/resume {thread_id, answer}` resumes with `Command(resume=answer)`.
- `finalize(kind, building_id, route_id, plan_id, message)` builds the API result in code.
- `DrEngine` is the only class that imports `dr.*`; tests inject `FakeEngine`.
- SSE events: `start, todos, delegate, tool_call, tool_result, file, thought, question, fallback, final, error`
  (see the docstring in `api_stream.py`). Every stream is recorded to `traces/<thread>.jsonl`;
  `GET /api/agent/replay?name=` replays it with original timing, labelled `mode: replay`.
- `GET /api/agent/share?thread_id=` returns a public LangSmith link when tracing is on.
- Trace panel (web): a list that appends one line per event, grouped by agent, with the todo list pinned
  at the top and file names clickable (fetch from `final.files` or the Workspace). It is an `aria-live="polite"`
  region that announces only `delegate`, `question` and `final` so a screen reader user is not flooded.

- [ ] **Step 1: Failing tests** (all offline, scripted fake models from `langchain_core`):
  `test_build_agent_smoke`; `test_visitor_run_asks_retries_and_grounds_numbers` ("appointment at the clinic"
  with two desks asks one question, retries after no_route with clearance 0.30, final numbers come from the
  engine, an invented "99 percent" is dropped); `test_coach_run_through_agent_adapts_plan`;
  `test_sse_endpoint_falls_back_when_model_fails`; `test_sse_endpoint_streams_real_agent_events`;
  `test_venue_question_returns_layout_report` (the plan's original: "where should our reception go" returns kind layout).
- [ ] **Step 2:** Fail. **Step 3:** Port the skeletons; implement `DrEngine` against the real modules.
- [ ] **Step 4:** Pass. Run once live on the fixture with `DR_MODEL` set and `LANGSMITH_TRACING=true`;
  record the trace file and the public LangSmith link in `docs/DEMO.md`. Commit `feat(agents): deep agent orchestrator`.
- [ ] **Step 5 (by 04:00):** Record two good traces (visitor on JRR, venue on JRR) for replay. Time each
  live run; if the visitor run is over 30 s, cut the orchestrator's todo items and use the fast model for it too.

### Task 14: Data resolver (A, 90 min)

**Files:** Create `engine/dr/resolver.py`, `data/directory.json`, `engine/tests/test_resolver.py`

**Interfaces:**
- `resolve(name: str) -> {building_id, property: dict | None, floor: str | None, suite: str | None, matterport_id: str | None, lat, lon, source: "costar"|"directory"}`. Tries CoStar tenant search, then `data/directory.json` (hand built for JRR, labelled as such in the UI).
- `cotenants(building_id) -> list[str]` for landmark phrases where CoStar has them.
- [ ] **Step 1: Failing test** three names (one JRR directory entry, two sponsor city tenants from saved fixtures in `data/raw/costar/`) resolve without network when `DR_OFFLINE=1`. **Step 2 to 4.** Commit.

#### v2 amendments

- `resolve()` also returns `prov` for each field. Join CoStar property to Matterport model by `geolocation` within 50 m plus street number match; mark the join `src: "calc"` with both inputs.
- If the kit has no tenant records, `resolve()` accepts a building name or address and `suite` comes from a Matterport room label or tag (`src: "matterport"`).

### Task 15: Arrival (A, 90 min)

**Files:** Create `engine/dr/arrival.py`, panel in `web/src/modes/summary.ts`.

**Interfaces:**
- `arrival(lat, lon, footprint, entrance: Entrance) -> Arrival`: fetch one Vexcel oblique or ortho image tile for the point, save under `web/public/buildings/<id>/arrival.jpg`, take the footprint edge nearest the traced entrance as `entrance_side`, set `dropoff` to the nearest curb point you confirm by eye, and write `driver_message` as "Please drop me at the {side} entrance of {name}, by {feature}." `confirmed` is true only after a human checks the pin.
- [ ] **Step 1:** Implement and run for JRR and the sponsor building. **Step 2:** Show image, pin and message in the summary panel; the rehearsal can start "at the curb" with one extra segment from drop off to entrance if the distance is known. Commit.

#### v2 amendments

- Uses Vexcel v2 or the Vexcel MCP only (v1 is deprecated). If no oblique exists at the point, use ortho and an optional phone photo with `prov.src = "hand"`.
- Writes `frames.geo_anchor` from the confirmed entrance pin and the facade bearing.
- Adds `arrival_score(listing) -> {total, parts}` for the venue table: drop off to entrance metres, entrance visible (bool, human confirmed), floor number, and `interior: null` when no scan exists.
- Refresh the Vexcel token at 05:00 (Task 16 checklist).

### Task 16: Demo hardening (all, from 03:00)

- [ ] `docs/DEMO.md`: the exact click path, the fallback for each step (no Wi Fi: local build and saved packages; no phone: laptop and headphones; no API: template coach line).
- [ ] Tunnel tested on an Android phone and an iPhone.
- [ ] Two blindfold runs by people who have not seen the map; record arrival, time, quiz score, and one change made because of it (this is your Phase 8 evidence).
- [ ] 2 minute backup video recorded before 06:00.
- [ ] Devpost text: target user, what each data layer does, what is measured versus assumed, the claims and non claims from spec section 9.

#### v2 amendments

- [ ] `docs/DEMO.md` contains section 5 of `review/agent3_experience.md`: kit list, 30 second pre judge checklist, consent script, hard of hearing options, the timed 60 second route, short and full versions, fallbacks.
- [ ] Measured tap latency on the demo laptop with the demo headphones, written in `docs/DEMO.md`.
- [ ] iPhone checks: silent switch on, screen lock and return (audio resumes after one tap), VoiceOver on (Step button works, app voice and VoiceOver do not double speak in screen reader mode).
- [ ] Android check: vibration on contact, TalkBack on with the Step button.
- [ ] Two blindfold runs by people who have not seen the map: record arrival, time, quiz score, **pointing error after run 1 and run 2**, and one change made because of it.
- [ ] Backup video as in section 5.6 of `review/agent3_experience.md`.
- [ ] Devpost and pitch use the honest lines in section 2.3 of `review/agent3_experience.md`; no "experience blindness" framing.

### Task 17: Observer view (B, 90 min, 23:00 to 01:00; relay part needs 10 min of D's `api.py`)

**Files:** Create `web/observer.html`, `web/src/observer/{protocol,bus,observer}.ts`, `web/src/observer/bus.test.ts`, `web/src/observer/observer.test.ts`. Modify `web/vite.config.ts` (add `observer.html` as an input and proxy `'/ws': { target: 'ws://localhost:8000', ws: true }`), `engine/dr/api.py` (relay endpoint, P1), `engine/tests/test_obs_relay.py`.

**Interfaces:**
- `protocol.ts`: `ObsMsg` as in section 4.2 of `review/agent3_experience.md`, `RunLogKind` imported from the Task 9 types.
- `bus.ts`: `openBus(session: string, opts?: { relay?: boolean }): { publish(m: ObsMsg): void; subscribe(fn: (m: ObsMsg) => void): () => void; close(): void }`. Always uses `BroadcastChannel("sv-obs-" + session)`; with `relay` also a WebSocket to `/ws/obs/{session}`. Pose throttled to 15 Hz inside `publish`. Never throws if neither transport exists.
- Rehearsal side: one `publish` call at each existing hook (`say`, tap, step and turn, RunLog events, quiz answer, point result, coach plan, run end). URL `?obs=<session>` turns publishing on, `&relay=1` adds the WebSocket.
- `observer.ts`: `class ObserverState { apply(m: ObsMsg): void; trails: Record<number, Vec2[]>; lastSay: string; taps: {at: Vec2; code: CellCode; ts: number}[]; summary: Record<number, EndMsg> }` (pure, testable) and a canvas renderer that draws the items in section 4.1 of `review/agent3_experience.md`. URL `observer.html?b=jrr&obs=<session>`.
- Relay (P1) in `api.py`:

```python
from collections import defaultdict
from fastapi import WebSocket, WebSocketDisconnect
_rooms: dict[str, set[WebSocket]] = defaultdict(set)

@app.websocket("/ws/obs/{session}")
async def obs_relay(ws: WebSocket, session: str):
    await ws.accept()
    _rooms[session].add(ws)
    try:
        while True:
            msg = await ws.receive_text()
            if len(msg) > 4096:
                continue
            for peer in list(_rooms[session]):
                if peer is not ws:
                    try:
                        await peer.send_text(msg)
                    except Exception:
                        _rooms[session].discard(peer)
    except WebSocketDisconnect:
        pass
    finally:
        _rooms[session].discard(ws)
```
  Uvicorn needs a WebSocket library (`uvicorn[standard]` or `websockets`); add it to the engine requirements.

- [ ] **Step 1: Failing tests**
  - `bus roundtrip` (Node 18+ has a global `BroadcastChannel`): two buses with the same session, `publish` a `say`, the other receives it; a different session does not.
  - `pose throttle`: 100 pose publishes within 1 s deliver at most 16.
  - `bus without transports`: with `BroadcastChannel` undefined and no relay, `publish` does not throw.
  - `observer state trails per run`: `hello` run 1, 3 poses, `hello` run 2, 2 poses gives trails of lengths 3 and 2.
  - `observer keeps taps 300 ms`: taps older than 300 ms are pruned on `apply`.
  - `test_obs_relay` (FastAPI `TestClient` websocket): a message from client A reaches client B in the same session, not client C in another, and never echoes to A.
- [ ] **Step 2:** Fail. **Step 3:** Implement bus and state, then renderer, then relay. **Step 4:** Pass.
- [ ] **Step 5:** Manual: rehearsal window on the laptop screen, observer window on the projector, play a full run 1, coach, run 2; check the before and after table fills. Then phone plus relay through the tunnel. Commit.

### Task 18: Showcase sync view (A with C, 90 min, P2, kit building only, needs a production Matterport key)

**Files:** Create `web/src/showcase/sync.ts`, `web/src/showcase/sync.test.ts`

**Interfaces:**
- `connectShowcase(iframe, modelId, key) -> Promise<Sdk | null>`; null on any failure, and the app continues without it.
- `nearestSweep(pos: Vec2, sweeps, floor) -> id` in the plan frame via `frames.plan_from_matterport`.
- `follow(traveller)`: on step, if the nearest sweep changed, `Sweep.moveTo(id, {rotation: {x: 0, y: yaw(heading)}, transition: FADEOUT, transitionTime: 400})`; else `Camera.setRotation` on turns, throttled to 4 per second.
- [ ] **Step 1: Failing tests** `nearest sweep picks closest on same floor`; `follow does not call moveTo twice for the same sweep`; `sdk failure leaves rehearsal running` (mock `connect` rejecting).
- [ ] **Step 2 to 4.** Commit. Allowlist `localhost`, the dev port and the tunnel host on the SDK key before testing on phones.

### Task 19: Provenance chips (all producers write `prov`; C builds the web chips; 90 min total)

Chips: `MP` Matterport, `VX` Vexcel, `CS` CoStar, `HAND` traced by hand, `CALC` computed (lists its input chips), `AI` vision model (with confidence; below 0.6 shows "possibly"). Tapping a chip shows the raw field path and pull time. A layer meter per building, e.g. `MP 23 · VX 4 · CS 5 · HAND 0 · CALC 9` beside JRR's `HAND 31`: putting the two side by side is the pitch. Chips carry `aria-label`.

- Engine: every producer writes `prov` entries. Web: chip component, layer meter per building, S key speaks the source of the current instruction.
- [ ] **Test** `every spoken number has a prov entry` (extends the Task 6 validator); `layer meter counts match prov`.

### Optional H: BLE cane handle (hardware track, only if parts are on hand)

ESP32 with a coin vibration motor on a transistor, a BLE GATT characteristic `pulse_ms` (uint16). `web/src/audio/haptics.ts` gains `connectBle()` using Web Bluetooth (works in Chrome on desktop and Android, not iOS). Contact taps call `pulse(20)`; landmark proximity calls `pulse(60)`.
