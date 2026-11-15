# SecondVisit handoff (paused Sun 15 Nov 2026, 00:36 ET)

Written for a fresh Claude Code controller session with no memory. Read this, then `CLAUDE.md`,
`docs/SOLO_PLAN.md`, `.superpowers/sdd/plan/rulings.md` (gitignored, lives only on this laptop) and the
two research files `review/agent5_interaction.md` and `review/agent6_arrival.md`.

## a. State at pause

- Time: 00:36 ET, Sun 15 Nov 2026. Demo freeze is 05:00.
- Main checkout: `/Users/dsandeshh/Downloads/HackPrinceton/CODEbase/secondvisit`, `main` at **1a74497**
  (remote `https://github.com/dsandeshh/SecondVisit.git`; the old remote URL still works but prints a "moved" notice).
- Tests on main at pause: engine **217 passed, 1 skipped** (`cd engine && .venv/bin/python -m pytest -q`),
  web **335 passed** (`cd web && npm test`); `npm run build` clean; `engine/scripts/demo_check.py` 14/14 at d41c904.
- Every stream agent is stopped. No background work is running.

## b. Done so far (task, one line, commit)

Plan tasks (`docs/plan.md` numbering):

| Task | What | Commit |
|---|---|---|
| 0, 1, S0 | pull and decision, package model, grid, fixture | before 22:00 |
| 2 | Matterport import to grid, rooms, doors, obstacles | b2d5afc |
| 2 follow-up (a) | doorways carved into the 15 unscanned offices, interiors blocked from routing, 14 diagonal edges dropped, `Room.scanned` | 9286b5a |
| 3 | annotator: face bearing, ray cast placement, merge, room labels, pick tool | 3a113b5 |
| 3 clinic run | 80 vision looks (cached in `data/x37LjPx62VA/vision_cache`), 47 landmarks after dedupe, desk 0.92 m from the pin | fbf745f, cc0e18b, 4df6e93 |
| 4 | cane friendly A* planner, NoRouteError, retry ladder | 0f2c09f |
| 4 fix (R17) | furniture (code 3) solid for clearance, failed-search time measured | 2fcc812 |
| 5 | segments (Douglas Peucker), wall side, route score | dce5e97 |
| 6 | instruction writer, grounding | before 22:00 |
| 7 | build CLI, `pipeline.build_package`, floor plan copy (R16) | 7df6f0f, a587c6e |
| 8 | web world, audio engine, cane, speech, input, Explore | e4049c4 |
| 9 + 10 web | Rehearse state machine, pocket summary, pointing task, quiz, coach handoff | f3df3e5 |
| 10 engine | coach rules, RunLog models, `/api/coach`, "hint" kind | ea78da6 |
| 11 | simulated traveller, error model, lost heatmap, `--sim` | 009b1b2 |
| 12 engine | layout candidates, evaluate, advise | 529ac4c, fix deca009 (silent ImportError gave 0% arrival) |
| 12 web | `venue.html` with Layout and Portfolio tabs | bf35f3a |
| 13 | Deep Agents orchestrator, five subagents, SSE stream, scripted fallback; checkpoint (d) live on the fixture | c0127ec, 0e6bde0 |
| 13 replays | named replays visitor and venue (fixture recordings committed, clinic recordings local) | 5a715ab |
| 14 | resolver and CoStar record | before 22:00, d049c94 |
| 15 | arrival from Vexcel, pins | 3614d05, d2cee70 |
| 16 engine | `/api/health` modes, `engine/scripts/demo_check.py` offline check | 5cabc4e |
| 17 | observer view and relay | f0a311f, f56fc75 |
| 18 P1 | Showcase tour iframe in the observer, localhost only | 76cb247, c3a2af8 |
| 19 engine | provenance in every producer | 447703a, f6b800a |
| 19 web | provenance chips, layer meter, S key source | b81b6c5 |
| 20 | portfolio ranking, live Houston run: 12 scored, 8 skipped, 0 errors, clinic 55.55 rank 9 | bc08cf4, 1ad408d, fbf745f |
| api.py | duplicate blocks removed, route hygiene test | d41c904 |

Human design decision work (23:37 onwards):

| Item | What | Commit |
|---|---|---|
| Docs | CLAUDE.md rule 7 rewritten (always app voice), SOLO_PLAN human decisions, research files | fd50c23, c808070, a93c20d, 1a74497 |
| 3D v1 | 3D rehearsal room, objects list, mini plan, live strip, overrides endpoint, `label_overrides` | 590e22b |
| UI_DESIGN 4.2b | the new experience documented | b081c25 |
| A7a | Kokoro audition script `web/scripts/voice.mjs`, 5 clips in `web/public/voice_audition/` | 16b0ead |
| A2 + interior | always app voice, interior cockpit polish, all 48 objects | b2443ca |
| B1, B2 | `engine/dr/geo.py` transforms, geo anchor (`plan_north_deg` 243.1), curb script and recovery lines | a1b7208 |
| B4 | second route and `costar` merged into the package | 9caf5ab |
| B5 | Vexcel obliques x4, elements/detect, property/extract, `oblique-east` in the package | 232c25e |
| B8 | `Landmark.spoken`, `BuildingPackage.voice_lines` (sha1 id rule) | b6e53f0 |
| names | instructions use spoken names, repeated names made unique, clinic tests skip without local data | 9b68ddb, 843ec6c, 183fd62 |
| TTS | `POST /api/tts`, `engine/scripts/prerender_voice.py`, `voice.mjs --render` | f47deb2 |
| (f), (g) | am_michael everywhere, safe unknown lines, canopy traced, second route TRIAGE | ff4644d |
| Step 3 | one event bus, HRTF buses, clips from position, sound ring, directional captions, fixes a to d | 46640f7 |
| Step 4 | Top 8 interactions with keymap and cue visuals | 7705410 |
| voice_lines | web literals, room size lines; 199 am_michael clips | 96c6997 |

## c. Worktrees and branches

All worktrees share the stash stack with the main checkout: never use bare `git stash` / `git stash pop`.

| Worktree | Branch | Head | State | Next step |
|---|---|---|---|---|
| `../sv-A` | stream-a | d049c94 | clean, nothing unpushed | idle; usable for any engine task |
| `../sv-A2` | stream-a2 | f6b800a | clean | shared fix worktree (R18) |
| `../sv-B` | stream-b | 96c6997 | clean, equals main | engine stream; has its own `engine/.venv`, `node_modules`, `data/x37LjPx62VA/{landmarks.json,landmarks.md,vision_cache}`, scratch images |
| `../sv-C` | stream-c | **de2394c "WIP: step 5"** | **pushed to `origin/stream-c` only, NOT on main** | see "Step 5 WIP" below |
| `../sv-D` | stream-d | 0e6bde0 | clean; untracked layout.py already committed | idle |

### Step 5 WIP on `origin/stream-c` (de2394c)

Web 345 tests pass and build is clean on that branch. It is off main only because
`engine/tests/test_names.py::test_fixed_ui_lines_cover_web_literals` fails until these literals are added
to `FIXED_UI_LINES` in `engine/dr/voice_lines.py`:

"Press Up to take a step.", "Press Left or Right to turn.", "Press Q to hear what is around you.",
"You're ready. Press Enter to start the rehearsal.", "Intro skipped. Press Enter to start the rehearsal.",
"Try turning left or right, then step.", "Press Space to hear the instruction again, or W for where you are.",
"Left the rehearsal. Press Enter on Explore to come back.", "Back in the rehearsal.", "Top bar.", "Rehearsal.",
"Keys.", "Agent and data.", "Paused. Press P to resume.", "Resumed.", "Fastest.", "Slowest.",
the new `KEYS_LINE` in `web/src/modes/interact.ts` (ends "... K: these keys again. P: pause. Plus and minus:
speech speed. F6: move between parts of the page."), and the pointing closeness phrases "That's close.",
"Not far off.", "Quite a way off." (pointing feedback is now "You were N degrees off. <phrase> The X is at N o'clock from here.").

Done in the WIP: guided intro (`web/src/modes/guide.ts`, Esc skips, localStorage memory, `?intro=1` forces),
next action in the bottom strip, recovery lines (3 bumps in 10 s; lost 20 s in Rehearse), arrival chime then
score in words, Escape/F6 way out of the Tab trap, chips on their own row in the top bar, clip playbackRate
follows + and −, clips preloaded inside the Start gesture.
Not done: P does not hold a clip mid-line; test that every mapped key answers synchronously (item g);
screenshots `v5_intro.png`, `v5_arrive.png`; top bar check at 1280/1440/1920; nothing browser-tested.

To land it: in `sv-B` add the literals (test first), rebuild the clinic and re-render clips (commands in g),
push to main; then in `sv-C` `git fetch && git rebase origin/main`, run both suites, push to main.

## d. Remaining work, priority order

1. Land step 5 (above). Then stream 2 steps in `docs/SOLO_PLAN.md` "Human decisions" order:
   step 6 outdoor scene, curb to door, fly in from the sky (agent6 4.1.3, 4.1.4, 4.1.5, 4.3) in NEW files
   (`web/src/three/outdoor.ts`, `web/src/geo/frame.ts` mirroring `engine/dr/geo.py`, `web/src/audio/outdoor.ts`),
   with the home address box (resolver offline for the clinic). Step 7 (GPS circle, day of visit page) drops first.
   Steps 3 and 4 are done; verify by ear and eye on the final package (nobody has played the app in a browser).
2. Second route, option 2 (human still to confirm, recommended): simulated traveller slides along fixed surfaces
   it bumps (behaviour, not error constants) plus a doorway instruction with step count ("Turn right through the
   doorway between the counter and the glass wall"). The real choke is a 0.8 m doorway at plan (-3.8, -7.2)
   (`scratchpad/lobby_gap_doorway.png`). Current second route: TRIAGE `door_13`, 19 steps, 6 segments, 45%.
   Main route `ent_main__dest`: 10 steps, 2 segments, 60%.
3. Generic street line: curb script line 3 "Traffic from Breton Ridge is behind you." names a street from a
   non-primary CoStar frontage (unverified). Replace with "Traffic from the road is behind you." unless verified.
4. Canopy human check in `pick.html` (currently "assumed", traced by Claude, about 1 m off the entrance line).
5. 04:00 batch review (real bugs only). Known items: clinic tests must skip without local data (done 9b68ddb,
   verify on a clean checkout); room size numbers engine vs web never compared on real rooms; `Speech.setOutput("screenreader")`
   dead code; `web/src/main.ts` dev-only `window.__sv`; observer `cue` message added to the protocol (CHANGELOG).
6. 04:30 integration check (`PROMPTS.md`, "Integration check"). 05:00 freeze, then the demo freeze prompt (`docs/DEMO.md`).
7. Not started: Task 18 P2 (SDK camera sync), Task 16 human parts (phone tunnel, blindfold run, backup video, Devpost),
   `docs/DEMO.md` click path pass, O/T/G/P/L/Home keys from agent5 (P1).

## e. Human decisions and answers (binding)

- Checkpoint (a): carve doorways into the 15 unscanned offices, mark them "not scanned", routes never enter; drop the 14 diagonal interior edges.
- Checkpoint (b): per-pano yaw rule (face1 bearing = face_yaw0_deg − pano_yaw, yaw0 90, clockwise); entrance (2.9, 0.1) heading 270; destination (−2.9, −4.3) is the reception desk.
- Checkpoint (c): clinic rehearsal reported at 22:52 (URL and keys); the screen has since changed to the 3D layout.
- Checkpoint (e): arrival pins D2 (drop off) and C1 (door) committed in `data/x37LjPx62VA/overrides.json`.
- Checkpoint (f): "1 o'clock" reference = facing the building, perpendicular to the facade (HAND confirmed).
  Drive lane unknown → "Listen for cars before you cross." Edge unknown → "Feel for a change in the ground with your cane."
  Door unknown → "Find the door handle with your hand; the door may be heavy." Canopy: yes, traced by Claude from
  `oblique_east.png` and the ortho, labelled assumed.
- Checkpoint (g): voice **am_michael** everywhere (`SV_VOICE=am_michael`); only one voice ships.
- Always app voice: no "app voice / my screen reader" choice; captions always visible with direction and an arrow.
- Style: Light Apple minimal, tokens in `web_tokens.css` / `web/src/styles/tokens.css`, no web fonts.
- 3D layout: top bar, 3D room centre, objects list + mini floor plan right, live instruction strip bottom, collapsible agent and data panel.
- 360 sound (HRTF everywhere), sound ring around the walker, captions with direction, one event bus.
- Fly in from the sky on address submit, walk starts at the curb, one continuous camera move into the interior.
- Stream 2 order: voice audition, interior 3D (reviewed GO), 360 sound + ring + captions, Top 8, pre-rendered voice + intro, outdoor + fly in, GPS/day of visit (drop first).
- Interior review GO with fixes a to e: a short names everywhere; b label only nearest/selected/destination; c captions never cut, 2 lines; d top view fit; e second route ≥60% simulated arrival in 30 to 60 steps (not achievable without option 2; decision pending).
- Efficiency mode: Sonnet implementers, max 2 streams, no per-task reviewer, one batch review at 04:00, UPDATE block after every task.

## f. Local only files (not in git, must stay on this laptop)

| What | Where |
|---|---|
| Secrets | `secondvisit/.env` (also copies in each worktree); `SV_VOICE=am_michael` appended |
| Sponsor caches and derived data | `secondvisit/data/x37LjPx62VA/raw/` (panos, faces, floorplan, cloud_sample.xyz, obliques, Vexcel JSON), `data/x37LjPx62VA/{landmarks.json,landmarks.md,vision_cache/,grid_preview.png}`, `data/costar/`; same under `sv-B/data/` |
| Clinic web package | `secondvisit/web/public/buildings/x37LjPx62VA/` (package.json, floorplan.jpg/json, arrival.jpg, arrival_ortho.json, oblique_east.png, layout_report.json, `voice/` 199 clips + index.json); copies in `sv-B` and `sv-C` |
| Portfolio | `secondvisit/web/public/portfolio.json` (also in sv-B) |
| Agent traces | `secondvisit/traces/` (clinic recordings `replay-*-clinic.jsonl` local only; fixture ones are committed) |
| TTS cache | `sv-B/data/tts_cache/am_michael/` |
| Kokoro model | `<worktree>/web/node_modules/@huggingface/transformers/.cache/onnx-community/Kokoro-82M-v1.0-ONNX/` (sv-B and sv-C; re-downloads on first `node scripts/voice.mjs` if missing) |
| Controller ledger | `secondvisit/.superpowers/sdd/plan/{progress.md,rulings.md,preflight.md}` (gitignored) |
| Screenshots and scratch | `/private/tmp/claude-501/-Users-dsandeshh-Downloads-HackPrinceton-CODEbase/319d7a46-2dc2-48a9-8075-0e2297a77add/scratchpad/` (v2_*, v3_sound, v4_*, obliques.png, lobby_gap*.png, clinic_landmarks.md; may be cleared by a reboot) |

Committed but sensitive-adjacent: `data/x37LjPx62VA/overrides.json` (hand pins only), `traces/replay-*-fixture.jsonl`, `web/public/voice_audition/*.wav`.

## g. How to start everything

```sh
cd /Users/dsandeshh/Downloads/HackPrinceton/CODEbase/secondvisit
# engine API (serves /api/health, /api/agent, /api/coach, /api/overrides, /api/tts, /ws/obs)
cd engine && .venv/bin/python -m uvicorn dr.api:app --port 8000 --reload &
# web
cd ../web && npm install && npm run dev            # http://localhost:5173
# offline demo check
cd ../engine && .venv/bin/python scripts/demo_check.py --require-clinic
# rebuild the clinic package (offline from cache; second destination from overrides.json)
.venv/bin/python -m dr.cli build --source matterport --model x37LjPx62VA \
  --out ../web/public/buildings/x37LjPx62VA/package.json --from ent_main --to dest --sim 300
# re-render any new voice lines (skips existing)
.venv/bin/python scripts/prerender_voice.py x37LjPx62VA --voice am_michael
```

URLs: rehearsal `http://localhost:5173/?b=x37LjPx62VA` (`&intro=1` forces the guided intro once step 5 lands,
`&obs=demo` observer session, `&op=1` operator panel); observer `observer.html?obs=demo`; venue `venue.html?b=x37LjPx62VA`;
pins `pick.html`; voice audition `voice_audition/`. Tests: `cd engine && .venv/bin/python -m pytest -q`;
`cd web && npm test && npm run build`. `pytest` is not on PATH; macOS has no `timeout`.

Keys (desktop Chrome, wired headphones): Tab to Start, Enter. Explore: Up walks, Left/Right turn 15°, Down back,
Q around me (Shift+Q with clock and steps), E ahead, Tab/Shift+Tab pick a place, Enter beacon (Esc stops), W where am I,
K keys, S source of line, Shift+S swap channels, `[` `]` `\` camera Behind/Top/Orbit, Enter (no place picked) starts
Rehearse. Rehearse: Up/Left/Right, Space repeat, B or Enter hint. Pointing: Left/Right 5°, Space confirm. Quiz: 1–4, R, Enter.
Summary: Space per stretch, Enter run 2. After step 5: + − rate, P pause, Esc/F6 leave the stage.

## h. Resume prompt for the next session

```
Resume SecondVisit. Read docs/HANDOFF.md first, then CLAUDE.md, docs/SOLO_PLAN.md, review/agent5_interaction.md,
review/agent6_arrival.md and .superpowers/sdd/plan/rulings.md. Main is at 1a74497 (engine 217 passed, web 335).
Worktrees sv-B (engine) and sv-C (web) exist; sv-C's step 5 WIP is on origin/stream-c (de2394c).

EFFICIENCY MODE (binding): Sonnet implementers, max 2 streams, no per-task reviewer, one batch review at 04:00
(real bugs only), chat messages 2 lines.

Order: (1) land step 5: add the WIP literals from HANDOFF.md section c to engine/dr/voice_lines.py in sv-B,
rebuild the clinic and re-render clips, push; then rebase stream-c on main, both suites, push. (2) Stream 2:
step 6 outdoor scene, curb to door and the fly in, in new files, screenshots at 1440x900 (home, fly in, curb,
door, interior). (3) Stream 1: second route option 2 if I confirm (sliding simulator plus doorway instruction),
generic street line, canopy check. (4) 04:00 batch review, 04:30 integration check (PROMPTS.md), 05:00 freeze
and the demo freeze prompt (docs/DEMO.md). Tell me the moment the new 3D experience is playable (checkpoint c2)
with the URL and the keys.

UPDATE BLOCK (binding): at the end of every finished task, and whenever you stop or need me, print exactly:

=== SECONDVISIT UPDATE <time from `date +%H:%M`> ===
Done: <task numbers and one line each, with commit ids>
Running: <stream 1: task, stream 2: task>
Tests on main: engine <passed/failed>, web <passed/failed>
Blocked or needs me: <checkpoint or question, or "nothing">
Risks: <anything that threatens the 05:00 freeze, or "none">
Next: <the next 2 tasks>
Usage: <any limit or rate warning seen, or "ok">
=== END ===
```
