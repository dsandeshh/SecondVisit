# SecondVisit handoff (Sun 15 Nov 2026, 01:25 ET)

For a fresh session with no memory. Read this, then `CLAUDE.md`, `docs/SOLO_PLAN.md`,
`review/agent5_interaction.md`, `review/agent6_arrival.md`, and `.superpowers/sdd/plan/rulings.md`
(gitignored, this laptop only). Freeze is 05:00.

- Main: `aca4a26`, remote `github.com/dsandeshh/SecondVisit`.
- Tests on main: engine **229 passed, 1 skipped**; web **437 passed**; `npm run build` clean;
  `engine/scripts/demo_check.py` 14/14 offline.
- No agents running. Worktrees sv-A, sv-A2, sv-B, sv-C, sv-D all equal main, nothing unpushed.

## What exists

Every plan task 0–20 is done. The engine builds a BuildingPackage offline from cached Matterport,
Vexcel and CoStar data: grid, rooms, doors, 47 annotated landmarks, two planned routes with
segments, instructions, provenance, a simulated traveller, a layout advisor, a Deep Agents
orchestrator with five subagents, a portfolio over 20 Houston models, and an observer relay.

The web app is a judge-facing 3D cockpit around an audio-first rehearsal:

- **Interior**: the real Matterport mesh (`scan.glb`, 17 MB, cut away at 2 m) is the default scene,
  with a built Plan view as fallback. Objects list (48), mini floor plan, live instruction strip,
  agent and data panel, honest chips (MP, VX, CS, AI+confidence, CALC, HAND, simulated, assumed).
- **Outdoor** (`?flow=full`): address box → fly in from 45 m onto the Vexcel ortho → drop-off pin,
  blue path with step ticks, massing, canopy → walk the curb to the door → camera through the door
  into the interior, one frame throughout.
- **Audio**: HRTF on every positioned sound, one event bus driving audio + sound ring + captions
  with direction + observer, the agent5 Top 8 interactions, room echo, outdoor traffic/beacon/canopy.
- **Voice**: am_michael only. 228 pre-rendered Kokoro clips, `POST /api/tts` for anything unclipped,
  a soft tone if that fails. No browser speech anywhere. Caption always equals the spoken text.

Routes: `ent_main__dest` Reception desk, 10 steps, 2 stretches, **69.7%** simulated arrival (the main
demo); `ent_main__door_3` Lab door, 36 steps, 7 stretches, 16 landmarks, **56.3%**.

Decisions made by the human, all binding: always app voice (no screen-reader choice); am_michael;
Light Apple minimal; the 3D cockpit layout; sound ring + directional captions; fly in; checkpoint
answers (a) unscanned offices carved and blocked, (b) pano yaw calibration, (c) rehearsal reviewed,
(e) arrival pins, (f) "1 o'clock" = facing the building perpendicular to the facade (HAND), drive
lane/edge/door unknown → safe lines, canopy traced from imagery (assumed), (g) am_michael; interior
fixes a–e; second route = Lab door.

## Open bugs and risks

1. **Git history holds sponsor imagery.** `docs/screens/*.png` (clinic mesh and floor plan) were
   committed earlier; they are now untracked and gitignored (`aca4a26`), but history still has them.
   Either rewrite history or keep the repo private. Rule 9.
2. **Software GL cannot demo the real mesh**: 6–7 fps, ~7 s load. With a GPU it is 60 fps and 2–4 s.
   The demo machine must use hardware GL, or press `/` for the Plan view.
3. **`scan.glb` is fragile**: it is gitignored and not reproducible by a subagent. An `rsync --delete`
   already destroyed it once. Never sync that folder with `--delete`. Rebuild: see commands.
4. **Clip coverage is verified only on this laptop** (clips are gitignored). If a line's text changes,
   re-render or it degrades to a tone.
5. **Nothing has been heard by a human.** Audio, the outdoor scene and the intro are untested by ear.
6. The doorway "wall" rule is a kind-based heuristic; the canopy is traced by Claude (assumed, ~1 m
   off the entrance line); the clinic's room labels are thin (most panos fall in one corridor room);
   `KEYS_LINE` does not mention the new `/` key, so that clip would need a re-render.

## Next six tasks, in order

1. **Play it with headphones** end to end (`?flow=full`), interior and outdoor, and fix what sounds
   wrong. This is the biggest untested surface and the demo depends on it.
2. **Decide the history/visibility question** in open bug 1 before anyone sees the repo.
3. **03:00 safety net**: confirm nothing P0 is missing; **04:00** batch review (real bugs only);
   **04:30** integration check (`PROMPTS.md`); **05:00** freeze, then the demo freeze prompt (`docs/DEMO.md`).
4. **Dress rehearsal** on the demo machine with hardware GL: run `docs/DEMO.md`'s click path, time it,
   check the Plan fallback and every labelled fallback (scripted, replay, simulated, assumed).
5. **Remaining human-only items**: phone over a tunnel, a blindfold run, the backup video, Devpost text.
6. **If time**: Task 18 P2 (Showcase camera sync), agent5's P1 keys (O, T, G, P, L, Home), the GPS
   circle and day-of-visit page (step 7, never started).

## Commands

```sh
cd /Users/dsandeshh/Downloads/HackPrinceton/CODEbase/secondvisit
cd engine && .venv/bin/python -m uvicorn dr.api:app --port 8000 --reload &   # API
cd ../web && npm install && npm run dev                                      # http://localhost:5173
cd ../engine && .venv/bin/python -m pytest -q                                # 229 passed, 1 skipped
cd ../web && npm test && npm run build                                       # 437 passed
cd ../engine && .venv/bin/python scripts/demo_check.py --require-clinic      # 14/14, no network
# rebuild the clinic package, then clips (every voice line needs a clip)
.venv/bin/python -m dr.cli build --source matterport --model x37LjPx62VA \
  --out ../web/public/buildings/x37LjPx62VA/package.json --from ent_main --to dest --sim 300
.venv/bin/python scripts/prerender_voice.py x37LjPx62VA --voice am_michael
# rebuild the real mesh if scan.glb is lost (needs a venv with trimesh + pillow)
.venv/bin/python scripts/fetch_matterpak.py x37LjPx62VA
<trimesh venv>/bin/python scripts/matterpak_to_glb.py x37LjPx62VA --tex 1024 --quality 80
```

URLs: `/?b=x37LjPx62VA` rehearsal (`&flow=full` outdoor first, `&intro=1` replay the intro,
`&obs=demo` observer session, `&op=1` operator panel); `observer.html?obs=demo`;
`venue.html?b=x37LjPx62VA`; `pick.html`; `outdoor.html` outdoor dev page; `voice_audition/`.

Keys: Tab to Start, Enter. Up walks, Left/Right turn, Down back. Q around me (Shift+Q detailed),
E ahead, Tab/Shift+Tab pick a place, Enter beacon (Explore only; Esc stops), W where am I, B hint,
Space repeat, K keys, S source, Shift+S swap channels, P pause, +/− speech rate, `[` `]` `\` camera,
`/` Real scan ↔ Plan, F6 move between regions, Esc leave the stage.

Local only, never in git: `.env`; `data/x37LjPx62VA/` (raw cache incl. `matterpak/`, `landmarks.json`,
`vision_cache/`); `web/public/buildings/x37LjPx62VA/` (package, voice clips, images, `scan.glb`);
`web/public/portfolio.json`; `traces/*-clinic.jsonl`; `data/tts_cache/`; `docs/screens/`;
`.superpowers/sdd/plan/`; the Kokoro model in `web/node_modules/@huggingface/transformers/.cache/`.

## Resume prompt

```
Resume SecondVisit. Read docs/HANDOFF.md, then CLAUDE.md, docs/SOLO_PLAN.md,
review/agent5_interaction.md, review/agent6_arrival.md, .superpowers/sdd/plan/rulings.md.
Main is aca4a26 (engine 229 passed 1 skipped, web 437). All worktrees are clean and equal main.

EFFICIENCY MODE (binding): Sonnet implementers, max 2 streams, no per-task reviewer, one review per
step, chat messages 2 lines.

Work the "Next six tasks" list in docs/HANDOFF.md in order. Ask me before anything that changes the
demo's shape. Print this block at the end of every finished task and whenever you stop or need me:

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
