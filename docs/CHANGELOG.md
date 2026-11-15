# Changelog

Contract and plan changes, newest first. Rule 2 in CLAUDE.md: any change to BuildingPackage, RunLog,
RunPlan or PointResult is logged here in the same commit as the code.

## 2026-11-14 (Sat): solo build, task log

- 23:55 Rehearsal screen cockpit (UI_DESIGN 4.2a): `web/src/three/` (mapping.ts plan->three with tests, room3d.ts), `web/src/ui/cockpit.ts` (objects list, mini floor plan, live strip, agent and data panel); three@0.170.0 pinned. Audio, keys and the stage unchanged; phones skip it. No contract change.
- 23:30 Overrides schema (R5) gains `label_overrides: {landmark_id: label}` (rename in the rehearsal objects list; merge_landmarks applies it and writes prov `landmark:<id>.label` as HAND). New `GET /api/overrides/<sid>` and `POST /api/overrides/<sid>/landmarks` {op: rename|remove|add} in `engine/dr/api.py`, writing only `data/<sid>/overrides.json`. No BuildingPackage change.
- 23:05 Task 19 web done: `web/src/ui/prov.ts` (chips MP/VX/CS/CALC/AI/HAND, AI "possibly" under 0.6, layer meter, `sourceLine`), chips in the pocket summary, layer meter on the rehearsal screen, S speaks the source of the current instruction in Rehearse (swap stays in Explore). No contract change.
- 23:20 Task 11 done + Task 4 fix round: `engine/dr/simulate.py` (ErrorModel, simulate, simulate_package; `--sim N` wired via pipeline.run_sim, package note labels it simulated); planner R17 (code 3 solid for clearance, not for wall trailing) and failed search timing (`PlannedRoute.failed_s`, `NoRouteError.failed_s`). No contract change.
- 23:20 Task 13 engine done: `engine/dr/agents/deep_agent.py` (DrEngine over real modules, five subagents incl. annotator, ask_visitor interrupt, finalize, scripted fallback), `api_stream.py` SSE router mounted in `api.py` (POST /api/agent, /resume, GET /replay, /share; serves layout per R4). Grounding goes through `dr.grounding.grounded` (R7). Simulate is a labelled stub ("simulated (stub: Task 11 not present)") until `dr.simulate` lands (R14). No contract change.
- 22:55 Task 10 engine done: `engine/dr/coach_rules.py` (tally, choose_focus, make_plan drills), pydantic RunLog/RunPlan/PointResult/RunEvent/QuizEntry in `package.py` (match types.ts, R3), `POST /api/coach` in `api.py`. **Contract change:** engine RunLog kind now includes "hint"; the web sends "hint" as is (no hesitate mapping).
- 22:10 Task 1 done (cf0f9db..ec268b4): BuildingPackage v1 + v2 fields in `engine/dr/package.py` (contract created; `Route.from` via alias), OccGrid, lobby fixture (`ent_w`, `desk`).
- 22:19 Task 15 fix (3614d05): one 60 m ortho size for fetch, pixel mapping and prov; side "unknown" until pinned.
- 22:19 Task 17 done (f0a311f, f56fc75): observer bus, state, canvas, WebSocket relay; `engine/dr/api.py` created (R4); message validation, no innerHTML, relay hardening, floor plan note (R16).
- 22:19 Task 2 code done (b2d5afc): Matterport walls to grid, rooms, gap and carved doors, cloud obstacles, overrides (R5); waits on checkpoint (a).
- 22:15 Task 6 done (025d3f2, 409d873): template instruction writer, `grounding.py` (numbers_in, grounded), shared `data/fixtures/clock_cases.json` (half to even), llm wrapper on DR_FAST_MODEL.
- 22:15 Task 15 code done (bdd9890, 08ad00c, f307d33): Vexcel arrival, pins, curb summary. **Contract change (R6):** Arrival gains `curb_to_door_m` and `dropoff_plan` (package.py; types.ts mirrors in Task 8). Fix pending: fetch path ortho size. Pins wait on the human (checkpoint e).
- 22:15 Design change (054ad41): Apple minimal, system font; tokens, UI_DESIGN.md and contrast tests rewritten.
- 22:10 Task 14 done (172c979): resolver, fuzzy name search over the index, CoStar record from the local kit.

## 2026-11-14 (Sat, about 22:40): tokens copy

- `web_tokens.css` (root, source) copied to `web/src/styles/tokens.css`. CLAUDE.md rule 13: copy again in
  the same commit whenever the root file changes; `test_tokens_copy_matches_root` fails if they differ.

## 2026-11-14 (Sat, about 22:30): Apple clean layer

- `docs/UI_DESIGN.md` 1.4: visitor screens (`index.html`) get no transparency or blur; the clean feel
  comes from bigger heavier titles, fewer elements, one primary action per screen and whitespace.
  "Copy driver message" is now secondary so the pocket summary has one primary ("Start run 2").
- Judge screens (`observer.html`, `venue.html`) may use frosted glass on the top bar and the agent
  trace panel only, via `.glass-bar` and `.glass-panel`. Tint alpha 0.94 keeps 7:1 over any backdrop
  (worst case 7.24:1); solid by default and under reduced transparency, more contrast and forced colours.
- `web_tokens.css`: `--fs-title-visitor`, `--fw-title-visitor`, `--lh-title-visitor`,
  `--tracking-title-visitor`, `--sp-section`, the `--glass-*` tokens with fallbacks, the two classes.
- Accessibility check gains a glass row and two tests to add with the web suite.

## 2026-11-14 (Sat, about 22:15): UI pack

- Added `docs/UI_DESIGN.md`, `docs/CLAUDE_CODE_SETUP.md` and `web_tokens.css` (repo root) from the UI pack.
- CLAUDE.md: `docs/UI_DESIGN.md` joins the read first list for `web/` work; new rule 13 (UI follows
  UI_DESIGN.md and the tokens; its accessibility rules and rule 7 win over any skill's taste).

## 2026-11-14 (Sat, about 22:00): wording

- SecondVisit is for blind and low vision people visiting any building; the Houston clinic is the first
  demo building and healthcare stays the lead story. "patient(s)" replaced in CLAUDE.md, DESIGN.md and
  DRESS_REHEARSAL.md, and in UI_DESIGN.md after it arrived. `review/` (archived research) left as written.

## 2026-11-14 (Sat, about 21:45): Task 0 pull

- APIS 1.3 rooms query: removed `panoLocations { floor { id } }`. The API rejects it
  (`FieldUndefined`); the quickstart's own rooms query does not ask for it either.
- `docs/DATA_STATUS.md` written: `DEMO_SID=x37LjPx62VA`, every layer present except the defurnished view.

## 2026-11-14 (Sat, about 21:15): plan v3.1, from the key checks

What the key checks found: the clinic `x37LjPx62VA` has 139 wall edges (all type `wall`), 21 rooms
labelled only "Other" (17) and "Void" (4), 20 panos, **no defurnished view**, MatterPak unlocked. The
CoStar kit is a local zip and the join to property 5615020 works. A second model, `hpGRjK5uFPW`
("Office B"), maps to the same property.

- **CoStar kit is local.** `COSTAR_KIT_ZIP` (path) is the main variable; `COSTAR_KIT_URL` and
  `COSTAR_API_KEY` are optional. CLAUDE.md rule 9, `.env.example`, APIS section 0 and section 4 updated.
  APIS section 4 now lists the kit's contents, the 52 keys of `commercial-property.jsonl` (39 per record),
  and the fields useful to us (use, tenants, suites, floors and lifts, frontage, parking). Record values
  for 5615020 stay in a gitignored notes file under `data/x37LjPx62VA/raw/`. Task 0 Step 6 reads the local zip instead of range requests.
- **Room labelling (Task 3).** The annotator names each non Void room (reception, waiting, exam, office,
  restroom, corridor, storage, other) from its panoramas. Code assigns panos to rooms by polygon
  (`pano_room`), the model only names the room, `merge_room_labels` takes the majority per room with ties
  to the higher confidence. Written to `Room.label` with `prov["room:<id>.label"]` (src `ai`). New tests
  `test_pano_room`, `test_room_label_majority`. No contract change: `Room.label` and `prov` already exist.
- **fixed_check without a defurnished view (Task 3).** Use the defurnished view if the model has one;
  otherwise fixed by kind (desk, door, glass_door, elevator, stairs, restroom, pillar, water; counter maps
  to desk) and movable for seating, other and sign unless most observations say `built_in`. The vision
  prompt and `parse_vision` gain `room` and `built_in`. `test_fixed_check` and
  `test_parse_vision_tolerant` extended. Prov key `landmark:<id>.fixed` documented in the v2 additions.
- **Sponsor data never in git.** `.gitignore` covers `data/costar/`, `data/*/raw/`, the index and basemap,
  built packages except the fixture, `portfolio.json`, `traces/` and mesh and archive files. CLAUDE.md
  rule 9 says sponsor data and anything derived from it never goes into git, a public demo or a public
  link. The Showcase SDK runs on localhost only (note under Commands).
- DESIGN.md data table: room labels come from the annotator; defurnished view only when present.
- Task 5: segments (Douglas Peucker, wall side, landmarks) and score_route landed.
- **Contract change: `Room.scanned` (Task 2 follow-up).** `Room` gains `scanned: bool = True` (package.py) and
  `scanned?: boolean` (types.ts). Rooms with no pano inside or unreachable from the walkable area are
  "not scanned": `mark_unscanned` carves a 0.9 m doorway (`door_ns_*`, prov `calc`), then blocks the room
  interior (code 1) so routes never enter. Overrides gain `drop_diagonal_walls` (clinic: true, drops 14
  diagonal scan edges). Clinic: 15 rooms not scanned.
- Task 9 (web): Rehearse mode (`RehearsalRun`), pocket summary, Session flow Explore, Rehearse, point, quiz, summary, run 2. Contract change (rule 2, R3): `RunLog`, `RunPlan`, `PointResult`, `RunLogKind`, `RunEvent`, `QuizEntry` added to `web/src/types.ts` (RunLog identified by `thread_id` + `route_id`, `point: PointResult[]`, PointResult has `target_bearing`). The engine pydantic mirror is still to come (Task 10 engine, stream D); until then `hint` is sent to `/api/coach` as `hesitate`.
- Task 10 (web): pointing task, 3 question quiz, coach handoff with a clearly labelled "scripted" fallback (`/api/coach` is not on main yet). Fixture package now carries a hand written 3 stretch route (`engine/scripts/export_fixture.py`).
- Task 7: `dr.pipeline.build_package` and `python -m dr.cli build` (clearance, drop-specks, sim guard, floor plan copy per R16); fixture package now carries a route; clinic builds offline from cache.
- Task 12 (web): `web/venue.html` with Layout and Portfolio tabs (R15), plan canvas with lost heatmap and R16 "Floor plan not available" note, before and after table, advisor rounds, agent trace from `POST /api/agent` (not `/api/layout`, R4) with a labelled offline view when the stream is down. Contract change (rule 2): `PortfolioRow` and `PortfolioFile` added to `web/src/types.ts`, mirroring the existing `PortfolioRow` in `engine/dr/package.py` (including `error` and `parts.routes_skipped`).
- Task 20 (live run): Houston portfolio of 20 models, 11 scored, 9 skipped with a data reason (8 "no walls", the clinic "no route to the Other room"), 0 errors; 21.8 s of compute, 448 s wall clock for the pulls. Written to gitignored `web/public/portfolio.json`; Portfolio tab in `venue.html` reads it (CoStar type and class shown as raw codes). `dr.portfolio --out` now resolves relative to the current directory (it used to land outside the repo).
- Portfolio: `build_light` uses `overrides.json` entrance and destination when present (labelled HAND, no "assumed" entrance) and `navigability` scores to that pin; CoStar `propertyType` and `buildingClass` codes now carry names (`propertyTypeName`, `buildingClassName`, from the kit's `enums.json`) and the Portfolio tab shows them. Added `engine/scripts/run_annotator.py` (Task 3 step 6 runner with a per face vision cache in gitignored `data/<sid>/vision_cache/`).
