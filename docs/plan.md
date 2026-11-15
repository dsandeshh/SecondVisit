# SecondVisit Implementation Plan (v3, Houston clinic)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type a clinic's name and get a curb to desk audio rehearsal of a real Houston medical office, built automatically from its Matterport scan, Vexcel imagery and CoStar record, with a pointing check, an adaptive coach, a venue layout report and a ranked portfolio of suites, all shown live to judges.

**Architecture:** A Python engine pulls and caches sponsor data, turns the Matterport wall graph, rooms and point cloud into a 10 cm occupancy grid, lets an annotator agent find landmarks in the panoramas, plans a cane friendly route, splits it into spoken segments, scores and simulates it, and writes one `package.json` per building. A TypeScript web app runs the audio rehearsal in the browser and an observer view for the projector. A FastAPI server streams the LangChain Deep Agents orchestrator (five subagents) to a trace panel.

**Tech Stack:** Python 3.11+ (numpy, scipy, shapely, pydantic v2, fastapi, uvicorn[standard], httpx, rapidfuzz, pillow, deepagents, langchain-anthropic, langsmith, pytest), Vite + TypeScript + vitest, Web Audio, Web Speech.

**Spec:** `docs/DRESS_REHEARSAL.md` (product now named SecondVisit). Design: `docs/DESIGN.md`. Every API call: `docs/APIS.md`. Research behind each decision: `review/`.

## Changes from the spec (v3)

1. **No JRR, no Princeton building.** The demo building is the Houston "Medical Office", Matterport `x37LjPx62VA`, CoStar property 5615020. Backups: `THASDAsdrw3` (Houston, CoStar 350372), `1uXpcwty9Sr` (Brentwood Medical Plaza, LA). Task 0 confirms which one we use by 21:45.
2. **Geometry comes from the Matterport wall graph and rooms** (available to hackathon keys), plus point cloud obstacles from the MatterPak. No tracing, no mesh slicing.
3. **Landmarks and room names come from the annotator agent** looking at panoramas and placing labels by ray cast from the pano position (Task 3). The clinic has no defurnished view and its Matterport rooms are only "Other" and "Void" (key checks, Sat 14 Nov), so fixed vs movable comes from the landmark kind plus the model's "built in or loose" judgement, and the annotator names each non Void room. Mattertags are empty, so they are not used.
4. **Human confirmations live in `data/<sid>/overrides.json`** (entrance pose, destination, door and curb points for arrival, skybox face yaw). Each override is shown with a `HAND` chip.
5. **Agents run on LangChain Deep Agents:** orchestrator plus site_investigator, annotator, route_planner, coach, layout_advisor. Scripted fallback and recorded replay, both labelled. LangChain gate at 01:30: no live trace by then means ship the scripted path and drop the LangChain track.
6. **Portfolio ranking (Task 20):** the pipeline runs headless over 15 to 25 Houston office and medical suites from `models_index.csv` with CoStar ids and ranks them by navigability. This is the scale moment.
7. **Pointing task** replaces the destination clock hour quiz question (random pointing averages 90 degrees).
8. **Observer view** on the projector, with the floor plan image as background and the Showcase tour beside it.
9. **Two output modes** ("app voice", "my screen reader"); phones use a full screen Step button, never swipes; no destination beacon in Rehearse.
10. **Demo safety and framing:** judge seated with a sleep mask, never walks masked; never "experience blindness"; wired closed back headphones only.
11. Arrival: Vexcel ortho (and oblique if the Vexcel tutorial gives one) for the clinic; door and curb pins confirmed by a human; the rehearsal opens with a spoken curb summary computed from them.

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
- Matterport model frame = our plan frame (metres, x right, y up, z up). Never rotate or mirror geometry.
- Sponsor keys are shared by every team: under 5 requests per second, every response cached in `data/<sid>/raw/`, signed URLs re queried rather than stored. Keys come only from `.env`.
- The demo never depends on a live sponsor API call: packages, images and recorded agent traces are built before 04:00.

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
11. **Signed URL expired** (skybox, floor plan, MatterPak links last about an hour). The client re queries the URL on a 403 and retries once; cached bytes are reused. Test in Task 0.
12. **Annotator mislabels or places a landmark on the wrong side** (wrong `face_yaw0_deg`). Calibration step plus a test that the calibrated desk lands within 1.5 m of the destination set in `pick.html`; low confidence spoken as "possibly"; `overrides.json` can delete or add. Test in Task 3.
13. **Wall graph has no door gaps**, so rooms are sealed. `ensure_doors` carves openings between rooms whose panos are disconnected. Test in Task 2.
14. **Portfolio model without walls or rooms.** Skipped with a reason in the table, never a crash. Test in Task 20.

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
  source: "matterport"|"fixture"; model_id: string | null; generated_at: string;
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
// Landmark.fixed comes from fixed_check (Task 3): the defurnished view when one exists, else kind plus the
//   model's built in judgement; prov key "landmark:<id>.fixed". AI room names use prov key "room:<id>.label".
//   prov keys use "pano:<id>" refs for AI landmarks and AI room labels.
```
`RunLog` (Task 9) gains event kind `"hint"` (coach weight 1.0, same as hesitate) and optional `point: PointResult[]` (Task 10). D widens the pydantic Literal for `kind` in the same commit C starts sending `hint`; until then C maps `hint` to `hesitate`.

---

## Priorities and timeline (v3, Saturday 20:45 to Sunday morning)

**P0, the demo fails without it:** Tasks 0, 1, 2, 3 (or overrides only), 4, 5, 6, 7, 8, 9, 10, 13 (or scripted), 16, 17.
**P1, wins the sponsor tracks:** Tasks 11, 12, 14, 15, 18 (iframe), 19, 20.
**P2, only if ahead:** Task 18 SDK sync, Optional H.

| Time | A: Data | B: Spatial | C: Experience | D: Agents and layout |
|---|---|---|---|---|
| 20:45 to 21:45 | Task 0 (keys, pull, decision) | Task 1 | Task 8 P0 items on the fixture | Task 6 |
| 21:45 to 23:30 | Task 14, then Task 15 | Task 2 | Task 8 | Task 3 (tools, pick.html, calibration) |
| 23:30 to 01:30 | Task 17 observer | Tasks 4, 5, 7: first clinic package by 01:00 | Task 9 | Task 3 run, then Task 13 |
| 01:30 to 03:00 | Task 20 portfolio | Task 11 | Task 10 web (pointing, quiz) | Task 10 engine, Task 13 (gate 01:30) |
| 03:00 to 05:00 | Task 19 engine; two blindfold test runs | Task 12 engine help, fixes | Task 19 chips, Task 18 iframe, fixes | Task 12; record traces |
| 05:00 freeze | Backup video by 06:00; Devpost | | | Pitch rehearsal |

---

### Task 0: Data pull and decision (A, 60 min, 20:45 to 21:45)

**Files:** Create `vendor/matterport/` (downloaded quickstart files), `engine/dr/mp_client.py`, `engine/dr/probe.py`, `docs/DATA_STATUS.md`, `data/<sid>/raw/*`

**Interfaces:**
- Produces `mp_client.graph(query: str, variables: dict | None = None) -> dict` (basic auth from env, retries once, sleeps to stay under 5 requests per second, raises `MatterportError` with the GraphQL error code). Port it from `vendor/matterport/matterport_quickstart.py`, plus `HttpFile` for range reads.
- Produces `python -m dr.probe pull --model SID` which caches to `data/<sid>/raw/`: `basics.json` (APIS 1.2), `rooms.json` (APIS 1.3), `panos.json` and `panos_defurnished.json` (APIS 1.4, 2k; the defurnished files are skipped when the model has no defurnished view, as for `x37LjPx62VA`), `faces/<pano_id>_<face>.jpg` for faces 1 to 4 of every pano (and `faces_def/` for the defurnished view), `floorplan.jpg` plus `floorplan.json` (origin, resolution), `matterpak.json`, `cloud_sample.xyz` (every 10th point read by range request), `vexcel_ortho.jpg` (Task 15 call), `index_row.json` (its row of `models_index.csv`). It skips files that exist.
- Produces `docs/DATA_STATUS.md` ending with `DEMO_SID=<sid>` and one line per layer: OK, partial or missing.

- [ ] **Step 1:** Get keys with `/costar-keys` in the track Discord, fill `.env`, download the five quickstart files into `vendor/matterport/` (links on the quickstart page, see `docs/APIS.md`).
- [ ] **Step 2:** Run the two curl checks in `docs/APIS.md` section 7. In the Model Playground, list the distinct `edges { type }` values for `x37LjPx62VA` and write them into `DATA_STATUS.md` (this decides how Task 2 finds doors).
- [ ] **Step 3: Failing test** `test_graph_auth_header` (mock httpx: request uses basic auth from env and the production URL) and `test_pull_skips_cached` (second pull makes no HTTP calls).
- [ ] **Step 4:** Implement, pass, then `python -m dr.probe pull --model x37LjPx62VA`.
- [ ] **Step 5: Decision by 21:45.** Use `x37LjPx62VA` if it has walls (at least 10 edges), at least 5 non Void rooms, panos with skyboxes, and the clinic is public facing. Otherwise pull `THASDAsdrw3`, then `1uXpcwty9Sr`. Record `DEMO_SID`. Open the 3D tour (`https://my.matterport.com/show/?m=<sid>`) and note where the entrance and the reception desk are, for `overrides.json`.
- [ ] **Step 6:** The kit is local (`COSTAR_KIT_ZIP`, see `docs/APIS.md` section 4). Read property 5615020 from `data/commercial-property.jsonl`, its tenancies from `data/location-occupancy.jsonl` and tenant names from `data/company-detail.jsonl` by streaming the zip members, and save them to `data/<sid>/raw/costar.json`. The join was checked on Sat 14 Nov and works. Commit.

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

### Task 2: Matterport import to grid, rooms, doors and obstacles (B, 2 h, 21:30 to 23:30)

**Files:** Create `engine/dr/mp_import.py`, `engine/tests/test_mp_import.py`, `data/fixtures/mp_square_room.json`

**Interfaces:**
- Consumes: `OccGrid` (Task 1), cached `rooms.json`, `panos.json`, `cloud_sample.xyz`, `overrides.json`.
- `walls_from_graph(rooms_json: dict, floor_id: str) -> list[WallSeg]` with `WallSeg = (a: Vec2, b: Vec2, thickness: float, type: str)`.
- `rasterize(walls, res=GRID_RES, margin_m=1.0) -> OccGrid`: every wall edge drawn as a band of width `max(thickness, 0.10)` with code 1; edges whose type is a door or opening (if Task 0 found any) are not drawn and become `Door`s. Grid extent = wall bounds plus margin.
- `rooms_from_graph(rooms_json, floor_id) -> list[Room]`: order each boundary's edges into a loop, polygon from vertex positions, `label` = first classification label, `area_m2` from `dimensions.areaFloor` else shoelace. Skip "Void".
- `ensure_doors(grid, rooms, panos) -> tuple[OccGrid, list[Door]]`: for every pair of rooms that each contain a pano and whose boundaries share or nearly share an edge (within 0.4 m), check grid connectivity between their panos; if not connected, carve a 0.9 m opening in the shared wall at the point nearest the segment between the two closest panos, and record a `Door` with `prov.src = "calc"`. Pano positions are known walkable points, so a pano never sits inside a wall cell.
- `obstacles_from_cloud(path: str, grid: OccGrid, floor_z: float) -> OccGrid`: cells with at least 8 points between `floor_z + 0.1` and `floor_z + 1.8` that are free and more than 0.15 m from a wall become code 3 (movable until the annotator proves fixed); blobs under 0.05 m² are dropped; cells within 0.4 m of any pano stay free. `floor_z` = 2nd percentile of point z within 1 m of panos.
- `load_overrides(sid) -> Overrides` with `entrance: {pos, heading_deg, label}`, `destination_landmark_id: str | None`, `extra_landmarks: list[Landmark]`, `arrival: {door_lat, door_lon, curb_lat, curb_lon} | None`, `face_yaw0_deg: float`.
- `build_from_matterport(sid) -> BuildingPackage` (no routes yet): grid, rooms, doors, entrances from overrides, `map_date` = `original_created` from the index row, `source = "matterport"`, `model_id = sid`, prov for every fact.

- [ ] **Step 1: Failing tests** on `mp_square_room.json` (a 6 m by 4 m room, four 0.16 m walls, one 1.0 m gap in the south wall, one pano at (3, 2)): `test_walls_rasterised` (cell at (3, 4.0) is 1, cell at (3, 2) is 0); `test_room_area` (24 ± 0.5); `test_door_gap_open` (cell at the gap centre is 0); `test_carves_missing_door` (two rooms with a solid shared wall and a pano in each become connected and one Door is recorded); `test_cloud_obstacle` (a 1 m cube of points at z 0.2 to 1.2 inside the room gives code 3 cells; points at z 2.5 add nothing; cells within 0.4 m of the pano stay 0); `test_pano_never_in_wall`.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass.
- [ ] **Step 5:** Run on `DEMO_SID`, save `data/<sid>/grid_preview.png` drawn over `floorplan.jpg` (place the image by `origin` and `resolution`). Eyeball alignment. Commit and tell C the clinic package path as soon as Task 7 can build it.

### Task 3: Annotator agent: landmarks from panoramas (D, 2.5 h, 21:45 to 00:30)

**Files:** Create `engine/dr/annotate.py`, `engine/tests/test_annotate.py`, `web/pick.html`, `web/src/pick/pick.ts`; the annotator subagent goes into `engine/dr/agents/deep_agent.py` with Task 13.

**Interfaces:**
- `face_bearing(face: int, x_px: float, width_px: int, yaw0_deg: float) -> float`: plan frame bearing (0 = +y, clockwise) of a pixel column in horizon face 1 to 4. Face k centre = `yaw0_deg + 90*(k-1)`, offset `atan((x_px - width/2) / (width/2))` in degrees. Skybox faces are assumed axis aligned to the model frame; `yaw0_deg` (and whether faces run clockwise) is set once by the calibration step and stored in `overrides.json`.
- `place(grid, pano_pos: Vec2, bearing_deg: float, max_m=12.0) -> Vec2 | None`: ray cast; returns the point 0.3 m before the first non free cell, or None.
- `Observation = {pano_id, face, bearing_deg, kind, label, confidence, pos}`; `merge(obs: list[Observation]) -> list[Landmark]`: cluster same kind within 1.0 m; position = mean; confidence = mean model confidence × min(1, panos_seen / 2); label from the most confident.
- `parse_vision(text: str) -> {room: {label, confidence} | None, items: list[{kind, label, x_px, confidence, built_in}]}`: tolerant JSON parse; unknown kinds become "other"; "counter" becomes kind "desk" with label "counter" (`LandmarkKind` has no counter); room labels outside `ROOM_KINDS` become "other"; confidence clipped to [0, 1]; `built_in` defaults to false; malformed returns `{room: None, items: []}`.
- Vision prompt (fixed vocabulary): "This is one 90 degree view inside a medical office. (1) What kind of room is the camera standing in: reception, waiting, exam, office, restroom, corridor, storage or other? (2) List visible objects a blind visitor could use as landmarks or must avoid: desk (reception or check in), counter, door, glass_door, elevator, stairs, seating, restroom, sign, pillar, water, other. For each, say whether it is built in (fixed to the wall or floor) or loose. JSON only: {room: {label, confidence 0 to 1}, items: [{kind, label, x_px (horizontal centre in pixels, 0 to {w}), confidence 0 to 1, built_in true or false}]}."
- **Room labelling.** The clinic's Matterport rooms are only "Other" and "Void", so the annotator names every non Void room from its panoramas. `ROOM_KINDS = ["reception", "waiting", "exam", "office", "restroom", "corridor", "storage", "other"]`. Code decides where: `pano_room(rooms, pano_pos) -> room_id | None` assigns each pano to the non Void room whose polygon contains it (shapely; nearest polygon within 0.3 m for a pano on a boundary; Void rooms never). The model only names the room: `record` stores each face's `room` answer as a `RoomObs = {room_id, pano_id, face, label, confidence}`. `merge_room_labels(obs: list[RoomObs]) -> dict[room_id, {label, confidence, panos}]`: per room, majority label over the panos (each pano votes once with its most confident face answer); a tie goes to the label with the higher maximum confidence; confidence = mean confidence of the winning votes. `finish()` writes `Room.label` and `prov["room:<id>.label"] = {src: "ai", ref: "pano:<id>,...", confidence}`; the web shows it as an `AI` chip, with "possibly" under 0.6. Rooms with no pano keep their Matterport label and a `MP` chip. This answers the sponsor's open problem "understand commercial spaces".
- `fixed_check(obs, defurnished_obs | None) -> dict[landmark_id, bool]`: if a defurnished view exists, a landmark is fixed if the same kind is seen within 1.0 m in it, and seating and other are movable unless seen there (`prov.src = "matterport"`). Otherwise (the clinic: no defurnished view) fixed by kind: `FIXED_KINDS = {desk, door, glass_door, elevator, stairs, restroom, pillar, water}` (counter arrives as desk) are always fixed (`prov.src = "calc"`); `MOVABLE_KINDS = {seating, other}` and `sign` are movable unless a majority of the landmark's merged observations say `built_in` (`prov.src = "ai"` with the mean confidence of those observations). The model's judgement can make a movable kind fixed, never a fixed kind movable.
- Annotator subagent tools (Task 13 wires them): `list_panos(route_id | None)` (route corridor first: panos within 3 m of the route, then the rest by distance from the entrance), `look(pano_id, face, view="furnished"|"defurnished")` (returns the cached image as an image block), `record(pano_id, face, items_json)` (code runs `parse_vision`, `face_bearing`, `place`, `pano_room`, stores landmark and room observations), `finish()` (code runs `merge`, `merge_room_labels` and `fixed_check`, writes `/landmarks.md` with a room table and the package landmarks and room labels with `prov.src = "ai"` and confidence). Budget: at most 60 `look` calls. The agent decides which panos and faces to look at and stops when every route segment has a landmark within 1.5 m and every non Void room that contains a pano has at least one room answer, or the budget is spent.
- `pick.html`: the floor plan image placed by origin and resolution with the grid overlay; click shows plan coordinates; click and drag sets a heading; buttons "Set entrance", "Set destination", "Add landmark"; Export downloads `overrides.json`.

- [ ] **Step 1: Failing tests** `test_face_bearing` (yaw0 0: face 1 centre is 0, face 2 centre is 90, right edge of face 1 is 45); `test_place_hits_wall` (fixture, from (2, 6) bearing 270 returns about (0.5, 6)); `test_merge_clusters` (three desk observations within 0.8 m from two panos become one landmark with confidence equal to the mean); `test_parse_vision_tolerant` (prose around JSON, an unknown kind, confidence 1.7, "counter" becomes desk, missing `room` and missing `built_in` all handled); `test_fixed_check` (with a defurnished view: desk seen in both views is fixed, chairs seen only furnished are movable; with `defurnished_obs=None`: a desk, a door and a pillar are fixed by kind, seating is movable, seating that most observations call `built_in` is fixed with `prov.src = "ai"`, a desk that the model calls loose stays fixed); `test_pano_room` (a pano inside a room polygon gets that room; a pano inside a Void room gets None; a pano 0.2 m outside a boundary gets the nearest room); `test_room_label_majority` (two panos in the same room: "exam" 0.6 and "exam" 0.7 against one "office" 0.9 gives "exam"; a tie, "waiting" 0.7 against "reception" 0.8, gives "reception"); `test_budget` (61st `look` returns an error string, no image).
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass.
- [ ] **Step 5 (calibration, 15 min, human):** in `pick.html`, pick a pano next to a distinctive feature visible in the Showcase tour (the reception desk). Look at faces 1 to 4 for that pano, find the face showing the desk, and set `face_yaw0_deg` so that `face_bearing` points from the pano toward the desk on the plan. Check one more pano. Save `overrides.json` with the entrance and destination too.
- [ ] **Step 6:** Run the annotator once through the agent (Task 13) or a script calling the same tools; review `/landmarks.md`; anything wrong goes into `overrides.extra_landmarks` or is deleted there. Commit.

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
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass (keep clinic grids under 2 s; downsample to 0.2 m for search if needed). Commit.

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
- Produces: `python -m dr.cli build --source {matterport,fixture} [--model SID] [--in PATH] --out PATH [--from ID] [--to ID] [--close-gaps M] [--sim N]`. Default from = first entrance, to = first landmark of kind desk. Writes a valid BuildingPackage with one route; runs Task 11 sim if `--sim` and that module exists.
- [ ] **Step 1: Failing test** `test_build_fixture`: build `--source fixture` to a temp path, load with `BuildingPackage.model_validate_json`, route has ≥ 2 segments, every instruction non empty.
- [ ] **Step 2 to 4:** Fail, implement, pass. Generate `web/public/buildings/fixture/package.json` and, as soon as Task 2 lands, `web/public/buildings/<DEMO_SID>/package.json` (Task 3 landmarks and overrides are merged in when present). Commit both.

### Task 8: Web world, audio, input, Explore mode (C, 4 h)

**Files:** Create `web/src/{main,types,config,world,clock}.ts`, `web/src/audio/*.ts`, `web/src/input/*.ts`, `web/src/modes/explore.ts`, `web/index.html`, `web/src/*.test.ts`

**Interfaces:**
- Consumes: `BuildingPackage` JSON from `/buildings/<id>/package.json` (`?b=<sid>`, default `fixture`).
- Produces: `class World { constructor(pkg); cellAt(p: Vec2): CellCode; raycast(origin: Vec2, deg: number, maxM: number): {dist: number, code: CellCode} | null; roomAt(p): Room | null; }` (step 0.05 m along the ray).
- Produces: `class Traveller { pos: Vec2; heading: number; caneDeg: number; step(dir: 1|-1): "ok"|"bump"; turn(deg: number): void; }` A bump leaves pos unchanged and plays a tap.
- Produces audio: `cane.ts` contact tap (8 ms filtered noise; wall bright, glass higher and with a ring, obstacle duller; louder when closer), `echo.ts` one ConvolverNode with a synthetic impulse whose decay = `0.3 + 0.08 * sqrt(room area)` seconds, footstep click per step, `landmarks.ts` an HRTF PannerNode loop per landmark within 6 m with a distinct timbre per kind, `speech.ts` `say(text, {interrupt: true})` that cancels anything pending and mirrors text to the live region, `haptics.ts` `pulse(ms)` that calls `navigator.vibrate` when present.
- Controls. Keyboard: Up/Down step, Left/Right turn 15 degrees, mouse x or A/D sweeps cane ±50 degrees, Space repeats the current instruction, H says heading as clock relative to the building entrance. Phone: as in the v2 amendments below (full screen Step button, body turns, gamma sweeps the cane, no swipes). Orientation is requested only from the Start button; if denied, say "Motion not available. Use the Step button and the arrow buttons." and continue.
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

### Task 13: Orchestrator on Deep Agents (D, 2 h, 00:30 to 02:30, LangChain gate at 01:30)

The annotator subagent (tools from Task 3) is the fifth subagent; site_investigator's tools are `resolve_place` (Task 14 `resolve`) and `inspect_building` (data availability from `data/<sid>/raw/` and `DATA_STATUS.md`, map date).

**Files:** Create `engine/dr/agents/deep_agent.py`, `engine/dr/agents/api_stream.py`,
`engine/tests/test_deep_agent.py` (start from the review skeletons in `review/langchain/`),
`web/src/trace/panel.ts`, mount the router in `engine/dr/api.py`, add the input box to the home screen.

**Interfaces:**
- `build_agent(model=None, sub_model=None, checkpointer=None) -> CompiledStateGraph`:
  `create_deep_agent(model, tools=[ask_visitor, finalize], system_prompt=ORCHESTRATOR_PROMPT,
  subagents=[site_investigator, annotator, route_planner, coach, layout_advisor],
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
- [ ] **Step 5 (by 04:00):** Record two good traces (visitor on the clinic, venue on the clinic) for replay. Time each
  live run; if the visitor run is over 30 s, cut the orchestrator's todo items and use the fast model for it too.

### Task 14: Resolver: name to model, CoStar record (A, 75 min, 21:45 to 23:00)

**Files:** Create `engine/dr/resolver.py`, `engine/tests/test_resolver.py`, `data/fixtures/index_small.csv`, `data/fixtures/costar_small.csv`

**Interfaces:**
- `search_index(text: str, city: str | None = None, k=5) -> list[Candidate]` with `Candidate = {sid, name, address, city, lat, lon, costar_property_id, score}`: rapidfuzz `token_set_ratio` over name plus address plus city; medical words ("clinic", "medical", "doctor", "dental", "physician") boost rows whose name contains them.
- `costar_record(property_id: str) -> dict | None` from the cached kit file (Task 0 step 6).
- `resolve(text: str) -> {best: Candidate | None, candidates: list[Candidate], costar: dict | None, ambiguous: bool, prov: dict}`. Ambiguous when the top two scores are within 5 points; the orchestrator then asks one question with `ask_visitor`.
- [ ] **Step 1: Failing tests** with `DR_OFFLINE=1`: "medical office houston" resolves to `x37LjPx62VA` in the small index; "suite 106" is ambiguous with two candidates; a CoStar id joins to its fixture row; no network calls.
- [ ] **Step 2 to 4.** Commit.

### Task 15: Arrival from Vexcel (A, 60 min, 23:00 to 00:00)

**Files:** Create `engine/dr/arrival.py`, `engine/tests/test_arrival.py`, summary panel in `web/src/modes/summary.ts` (C adds the panel; A provides the data)

**Interfaces:**
- `vexcel_ortho(lat, lon, half_m=40, px=1400) -> bytes` (APIS section 3; WKT in lon lat order; 403 raises `VexcelCoverageError`).
- `arrival(sid, overrides) -> Arrival`: image saved to `web/public/buildings/<sid>/arrival.jpg`; `dropoff` = the curb pin; `entrance_side` = compass side of the door relative to the building (bearing from model lat/lon to the door pin, as N, NE, E ...); `curb_to_door_m` = haversine distance; `driver_message` = "Please drop me at the {side} entrance of {name}, {address}." `confirmed` = true only if both pins are in `overrides.json`.
- Spoken curb summary for the first rehearsal line: "From the drop off, the entrance is about {steps} steps {clock} o'clock." (steps from `curb_to_door_m / STEP_M`).
- If the Vexcel tutorial (keys card) gives an oblique or a footprint call, add `oblique.jpg` and a footprint edge as `entrance_side` evidence; otherwise ortho only.
- [ ] **Step 1: Failing tests** `test_wkt_lon_lat_order`; `test_side_from_bearing` (door due east of the centre gives "east"); `test_unconfirmed_without_pins`; `test_403_raises_coverage_error` (mocked).
- [ ] **Step 2 to 4.** Run for `DEMO_SID`; confirm pins by eye on the ortho in `pick.html` (add a map mode or read pixel coordinates). Commit.

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

### Task 17: Observer view (A, 90 min, 00:00 to 01:30; relay part needs 10 min of D's `api.py`)

Background: the Matterport `floorplan.jpg` placed by its origin and resolution (Task 0), walls from the grid on top. Side panel: the Showcase tour (Task 18).

**Files:** Create `web/observer.html`, `web/src/observer/{protocol,bus,observer}.ts`, `web/src/observer/bus.test.ts`, `web/src/observer/observer.test.ts`. Modify `web/vite.config.ts` (add `observer.html` as an input and proxy `'/ws': { target: 'ws://localhost:8000', ws: true }`), `engine/dr/api.py` (relay endpoint, P1), `engine/tests/test_obs_relay.py`.

**Interfaces:**
- `protocol.ts`: `ObsMsg` as in section 4.2 of `review/agent3_experience.md`, `RunLogKind` imported from the Task 9 types.
- `bus.ts`: `openBus(session: string, opts?: { relay?: boolean }): { publish(m: ObsMsg): void; subscribe(fn: (m: ObsMsg) => void): () => void; close(): void }`. Always uses `BroadcastChannel("sv-obs-" + session)`; with `relay` also a WebSocket to `/ws/obs/{session}`. Pose throttled to 15 Hz inside `publish`. Never throws if neither transport exists.
- Rehearsal side: one `publish` call at each existing hook (`say`, tap, step and turn, RunLog events, quiz answer, point result, coach plan, run end). URL `?obs=<session>` turns publishing on, `&relay=1` adds the WebSocket.
- `observer.ts`: `class ObserverState { apply(m: ObsMsg): void; trails: Record<number, Vec2[]>; lastSay: string; taps: {at: Vec2; code: CellCode; ts: number}[]; summary: Record<number, EndMsg> }` (pure, testable) and a canvas renderer that draws the items in section 4.1 of `review/agent3_experience.md`. URL `observer.html?b=<sid>&obs=<session>`.
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

### Task 18: Showcase tour in the observer (C, 30 min P1; SDK sync P2)

- P1: an iframe `https://my.matterport.com/show/?m=<sid>&play=1&qs=1` in the observer view's side panel, shown only if the model's `visibility` is public or unlisted. Test: `observer shows tour only when public`.
- P2 (only with `MATTERPORT_SDK_KEY` and the domain allowlisted): move the tour to the pano nearest the traveller on each step; spec in `review/agent2_data.md` (its Task 17 "Showcase sync"). Any SDK failure leaves the rehearsal running.

### Task 19: Provenance chips (all producers write `prov`; C builds the web chips; 90 min total)

Chips: `MP` Matterport, `VX` Vexcel, `CS` CoStar, `HAND` confirmed by a person, `CALC` computed (lists its input chips), `AI` vision model (with confidence; below 0.6 shows "possibly"). Tapping a chip shows the raw field path and pull time. A layer meter per building, e.g. `MP 23 · VX 4 · CS 5 · HAND 0 · CALC 9` where `HAND` appears only on human confirmed pins (entrance, destination, curb, door): the meter shows how little a person had to do. Chips carry `aria-label`.

- Engine: every producer writes `prov` entries. Web: chip component, layer meter per building, S key speaks the source of the current instruction.
- [ ] **Test** `every spoken number has a prov entry` (extends the Task 6 validator); `layer meter counts match prov`.

### Task 20: Portfolio ranking (A with B, 90 min, P1, 01:30 to 03:00)

**Files:** Create `engine/dr/portfolio.py`, `engine/tests/test_portfolio.py`, a Portfolio tab in `web/venue.html`

**Interfaces:**
- `pick_candidates(index_csv, city="Houston", n=20) -> list[row]`: commercial, has lat and `costar_property_id`, `room_count >= 5`, `floor_count == 1`, name or AI summary suggests office or medical; medical first.
- `build_light(sid) -> BuildingPackage`: pulls only `basics` and `rooms` (APIS 1.2, 1.3; no panos, no cloud), runs Task 2 `rasterize`, `rooms_from_graph`, `ensure_doors`; **assumed entrance** = the pano with the lowest numeric label (scan order usually starts at the door; labelled "assumed"); destination = centroid of the room labelled Reception, Lobby or Waiting, else the largest room.
- `navigability(pkg) -> {total, parts, build_s}`: Task 5 `score_route` for entrance to destination, plus mean `wall_share` and `decisions` over routes from the entrance to every room.
- `python -m dr.cli portfolio --city Houston --n 20 --out web/public/portfolio.json` writes rows with sid, name, address, CoStar fields, score parts, build seconds, and a link to the 3D tour. Throttled to stay under 5 requests per second.
- Venue view Portfolio tab: sortable table, "assumed entrance" chip, total build time, and "open rehearsal" for any row (builds the full package on demand).
- [ ] **Step 1: Failing tests** on 3 cached fixture models: deterministic ranking; `assumed entrance` flag set; a model with no walls is skipped with a reason, not a crash.
- [ ] **Step 2 to 4.** Run it live once, record total time for the pitch. Commit.

### Optional H: BLE cane handle (hardware track, only if parts are on hand)

ESP32 with a coin vibration motor on a transistor, a BLE GATT characteristic `pulse_ms` (uint16). `web/src/audio/haptics.ts` gains `connectBle()` using Web Bluetooth (works in Chrome on desktop and Android, not iOS). Contact taps call `pulse(20)`; landmark proximity calls `pulse(60)`.
