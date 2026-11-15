# Claude Code prompts for SecondVisit (v3, Houston clinic)

**Setup once:** create the repo, then put in it: `CLAUDE.md` at the root; `docs/` (DESIGN.md, APIS.md,
plan.md, plus your spec as `docs/DRESS_REHEARSAL.md`); `review/` from this kit. Then download
the sponsor quickstart files into `vendor/matterport/` (links in `docs/APIS.md`) and fill `.env` from
`/costar-keys` in the track Discord.

Each person runs Claude Code in VS Code in their own clone and pastes their lane's prompts in order.
If fewer people are coding, one session can run several lanes with the "Solo driver" prompt at the end.
Replace anything in angle brackets.

---

## S0. Scaffold (first, one person, 15 min)

```
Read CLAUDE.md, docs/DESIGN.md, docs/APIS.md and docs/plan.md. Scaffold the repo exactly as the
"Repo layout" in CLAUDE.md: engine/ as a Python 3.11+ package `dr` with pyproject.toml listing every
dependency in that layout (plus pytest, python-dotenv), engine/tests/ with one passing smoke test;
web/ as Vite + TypeScript with vitest, a dev proxy from /api to localhost:8000 and from /ws to
ws://localhost:8000 (ws: true), and entry points index.html, observer.html, venue.html, pick.html;
data/fixtures/, traces/, docs/CHANGELOG.md; .gitignore covering .env, data/*/raw, node_modules,
__pycache__; .env.example listing every variable in CLAUDE.md rule 9 with no values. Create
engine/dr/config.py and web/src/config.ts with the rule 4 constants. Do not touch vendor/ or review/.
Run both test suites, commit "chore: scaffold", push. Do not implement any task.
```

---

## Lane A: Data (Matterport pull, CoStar, Vexcel, observer, portfolio)

**A1. Pull and decide (Task 0)**
```
You own Task 0 in docs/plan.md. Read docs/APIS.md and vendor/matterport/AGENTS.md first, then port
graph() and HttpFile from vendor/matterport/matterport_quickstart.py into engine/dr/mp_client.py
(basic auth from .env, production URL only, under 5 requests per second, re query on an expired
signed URL). TDD the two listed tests. Then run the two curl checks from APIS section 7 and
`python -m dr.probe pull --model x37LjPx62VA`. Print a short table: walls (edge count and distinct
edge types), non Void rooms with labels, panos with skyboxes, defurnished view yes or no, MatterPak
yes or no, visibility, CoStar record found yes or no. Apply the Step 5 decision rule and tell me the
DEMO_SID, pulling a backup if needed. Write docs/DATA_STATUS.md. Commit.
```

**A2. Resolver (Task 14), then arrival (Task 15)**
```
You own Tasks 14 and 15. TDD each with the listed tests, offline fixtures only. For Task 15 call
Vexcel exactly as docs/APIS.md section 3 shows (WKT in lon lat order). Save the ortho for DEMO_SID.
Write prov entries for every fact (VX for imagery, CS for CoStar fields, HAND for pins from
overrides.json, CALC for distances). Leave confirmed=false until both pins are in overrides.json and
tell me where to click in pick.html to set them. Commit after each task.
```

**A3. Observer view (Task 17)**
```
You own Task 17. TDD the six listed tests: bus and state first, then the canvas renderer with the
Matterport floor plan image as background (placed by origin and resolution), then the WebSocket relay
in engine/dr/api.py (coordinate the 10 minute api.py edit with lane D). Protocol: section 4.2 of
review/agent3_experience.md; what to draw: section 4.1. Projector readable from 5 m: big plan, high
contrast, large "what they hear" strip, run 1 and run 2 trails with their pointing errors, agent
trace panel area on the right. Commit.
```

**A4. Portfolio ranking (Task 20)**
```
You own Task 20 with help from lane B. TDD the three listed tests on cached fixtures. Then run
`python -m dr.cli portfolio --city Houston --n 20` live once at under 5 requests per second, print the
ranked table and the total build time, and build the Portfolio tab in venue.html: sortable, CoStar
fields, "assumed entrance" chip, link to each 3D tour, "open rehearsal" per row. Commit.
```

**A5. Provenance in the engine (Task 19, engine half)**
```
You own the engine half of Task 19. Make every producer write prov entries with the Prov type from
the contract. Add the test "every spoken number has a prov entry". Commit.
```

---

## Lane B: Spatial (grid, import, planner, simulation)

**B1. Grid and fixture (Task 1)**
```
You own Task 1 in docs/plan.md. TDD exactly as listed. engine/dr/package.py must match the Shared
contract and its v2 additions field for field (source is "matterport" or "fixture"). Then OccGrid and
lobby_fixture. Commit, push, and tell me the fixture entrance and desk ids for lane C.
```

**B2. Matterport import (Task 2)**
```
You own Task 2. Build data/fixtures/mp_square_room.json first, then TDD the six listed tests. Read
docs/DATA_STATUS.md for the distinct edge types lane A found: if a door or opening type exists, use it;
otherwise rely on ensure_doors. Run build_from_matterport on DEMO_SID and save grid_preview.png over the
Matterport floor plan image. Show me the preview path and list any rooms that are disconnected or any
place the walls and the floor plan disagree. Commit.
```

**B3. Planner, segments and score, CLI (Tasks 4, 5, 7)**
```
You own Tasks 4, 5 and 7, in that order, each with TDD as listed. Weights are fixed by the plan; ask
before changing them. Implement the NoRouteError retry ladder exactly as Review Focus item 3 says.
Task 7 builds from Matterport (`--source matterport --model SID`), merging overrides.json and the
annotator's landmarks when present. Push web/public/buildings/fixture/package.json first, then the
clinic package as soon as it builds (target 01:00), and tell lane C. Print the clinic route's segments
and score parts as a table.
```

**B4. Simulated traveller (Task 11), then help with Task 20**
```
You own Task 11. TDD with fixed seeds. test_vague_lowers_arrival is the gate: if it fails, report both
arrival rates and the error model values before changing anything. Wire --sim 300 into the CLI and
rebuild the clinic package. Then help lane A make portfolio builds fast (build_light under 10 s each).
```

---

## Lane C: Experience (audio rehearsal app)

**C1. World, audio and Explore (Task 8 with its v2 amendments)**
```
You own Task 8 including its v2 amendments in docs/plan.md. web/src/types.ts must match the contract
exactly. Write every listed vitest test first (the original seven plus the v2 list) and watch them
fail. Implement in the amendment's P0 order: start sequence (audioSession playback before
AudioContext; resume, prime speech and request orientation inside the Start click before any await),
output mode choice, key throttle, blur pause, speech priority with a local voice, auto sweep with
2 degree interpolation and the tap gate, space mapping, then the rest. Use ?b=fixture until lane B
pushes the clinic package. Then run npm run dev and tell me exactly what to try with wired headphones.
```

**C2. Rehearse and summary (Task 9 with v2 amendments)**
```
You own Task 9 including its v2 amendments. TDD as listed. Export RunPlan, RunLog and PointResult
exactly as written. Send "hint" as "hesitate" until lane D confirms the engine accepts "hint". Home
screen mode switch: Explore, Rehearse, Check yourself, Pocket summary, keys 1 to 4, announced. The
first Rehearse line is the curb summary from the package's arrival when present. Call the observer
bus publish hooks at every event (no op if the bus is missing). Commit.
```

**C3. Pointing task, quiz and coach handoff (Task 10 web side)**
```
You own the web half of Task 10 including the pointing task. TDD as listed. After arrive: pointing
task, then three quiz questions, then POST the RunLog to /api/coach. Start the next run immediately
with the deterministic plan (port choose_focus and make_plan) and swap in the agent's plan only if it
arrives before Start. Speak the coach line. Run 2 ends with a second pointing task; announce both
errors in degrees and publish them to the observer. Commit.
```

**C4. Chips, Showcase iframe, polish (Tasks 19 web, 18 P1)**
```
You own the web half of Task 19 and Task 18 P1. Chip component, layer meter, S key speaks the source
of the current instruction, aria-labels. Showcase iframe in the observer side panel only for public
or unlisted models. Then polish: reset (R twice) back to Start, the operator panel behind ?op=1,
large type everywhere. Commit.
```

---

## Lane D: Agents and layout

**D1. Instruction writer (Task 6)**
```
You own Task 6. TDD as listed. llm.py reads DR_FAST_MODEL from env and returns "" on any failure.
Smoothing never changes a number, side or clock hour; numbers_match enforces it. Commit, then show
template and smoothed instructions for every fixture segment side by side.
```

**D2. Annotator (Task 3)**
```
You own Task 3. TDD the six listed tests with a fake vision model first. Then build pick.html (floor
plan image by origin and resolution, grid overlay, click for coordinates, drag for heading, Set
entrance, Set destination, Add landmark, Export overrides.json). Then walk me through the calibration
step: show me the pano and the four faces to look at, and set face_yaw0_deg from my answer. Then run
the annotator tools once on DEMO_SID with DR_FAST_MODEL (at most 60 looks, route corridor first),
write /landmarks.md and a table of every landmark with kind, confidence, fixed or movable and
position. Commit.
```

**D3. Deep agent layer (Tasks 10 engine side, 12 agent part, 13)**
```
You own the agent layer on LangChain Deep Agents: Task 10 engine side, the agent loop part of Task 12,
and Task 13, as written in docs/plan.md. Skeletons in review/langchain/ (deep_agent.py, api_stream.py,
test_deep_agent.py) pass 13 offline tests on deepagents 0.7.38.

Order: (1) engine/dr/coach_rules.py with TDD (tally, choose_focus, make_plan with drills; accept the
"hint" kind with weight 1.0 and tell lane C when merged). (2) Copy the skeletons into
engine/dr/agents/ and engine/tests/, fix imports, confirm the 13 tests pass before changing anything.
(3) Add the annotator as the fifth subagent with the Task 3 tools, and site_investigator's
resolve_place (Task 14) and inspect_building. (4) Implement DrEngine against the real modules by
reading their Interfaces blocks; keep the FakeEngine tests green and tell me any missing function.
(5) Mount api_stream.router in dr/api.py; keep /api/coach's response shape with a 12 s timeout and the
deterministic fallback. (6) web/src/trace/panel.ts: large type, grouped by agent, todo list pinned,
the deciding line highlighted.

Rules: geometry decides, models describe; grounded() on every user facing model sentence; only
DR_MODEL and DR_FAST_MODEL; the scripted fallback stays working and labelled. LangChain gate 01:30:
tell me if the orchestrator plus annotator, coach and layout subagents are not producing a live trace.
Once it works, record traces/visitor_clinic.jsonl and traces/venue_clinic.jsonl, get the LangSmith
share link, and time both runs. Stop and report if a live visitor run takes over 40 s.
```

**D4. Layout advisor and venue view (Task 12)**
```
You own the rest of Task 12: candidates, evaluate and the deterministic advise in layout.py with TDD,
then venue.html's layout tab: SSE trace on the left; on the right the floor plan, current reception
route grey, simulated lost heatmap red (labelled "simulated"), proposed desk and route green, before
and after table, rounds log. Projector readable. Commit and give me a screenshot path.
```

---

## Anyone

**Solo driver (one Claude Code session running several lanes)**
```
Read CLAUDE.md, docs/DESIGN.md, docs/APIS.md and docs/plan.md. Use superpowers:subagent-driven-development
to execute the plan's P0 tasks in this order: 0, 1, 2, 4, 5, 6, 7, 8, 9, 3, 13, 10, 17, 16; then P1:
11, 12, 14, 15, 20, 19, 18. One fresh subagent per task with that task's full text, its v2 amendments,
the Shared contract, Global Constraints and Review Focus; a fresh reviewer after each task. Stop and
ask me at Task 0 step 5 (building decision), Task 3 step 5 (calibration) and Task 15 (pins).
```

**Keep going (when you step away)**
```
Read docs/plan.md. Find the next unchecked P0 task in lane <A|B|C|D> whose dependencies are met, then
P1, then P2. Do it with TDD including its amendments, run both test suites, commit, push, tick its
boxes in docs/plan.md, continue. Stop and note it in docs/CHANGELOG.md if a test gate fails twice, a
dependency is missing, a sponsor API returns errors twice, or it is past 05:00.
```

**Review before merge**
```
Use superpowers:requesting-code-review on the last <N> commits. Check against docs/plan.md, the Shared
contract, Global Constraints and all Review Focus items. Rank problems by how likely they are to break
the demo. Do not fix anything yet.
```

**Integration check (02:30)**
```
Run the full path on DEMO_SID: build with --sim 300, start the API and web, open the rehearsal with
?obs=demo and observer.html with the same session, then Explore, Rehearse, the pointing task, the
quiz, the coach's second run with its pointing task, the summary with arrival, the agent trace panel,
venue layout and portfolio tabs. Then cut the network and repeat the agent part to confirm the scripted
fallback and replay work and are labelled. List every failing step with the exact error. Fix only
what blocks the demo.
```

**Demo freeze (05:00)**
```
Freeze features. Write docs/DEMO.md from Task 16 and section 5 of review/agent3_experience.md: kit
list, 30 second pre judge checklist, consent script, hard of hearing options, the timed 60 to 80 second
route on the clinic, measured tap latency, and the commands to start everything from a cold laptop with
no network (prebuilt packages, recorded traces, template coach line). Run it once from a fresh clone.
```
