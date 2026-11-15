# SecondVisit solo plan (full scope, four parallel streams)

Started Sat 14 Nov 2026, 22:05. One person, one Claude Code controller session, every task in
`docs/plan.md`, nothing cut. Node v26.13.1, Python 3.12.

## How it runs

- **Controller** (the main session) plans, dispatches, reviews, merges and keeps the ledger. It never
  writes feature code itself.
- **Per task:** a fresh implementer subagent gets the task's full text from `docs/plan.md` (with its v2
  amendments), the Shared contract, Global Constraints and Review Focus, and works test first. A fresh
  reviewer checks spec and quality. Findings go back to the implementer; **after two failed fix rounds
  the working part is committed behind a flag, noted in `docs/CHANGELOG.md`, and the stream moves on.**
- **Four streams in parallel**, each in its own git worktree and branch so they never edit the same
  checkout: `../sv-A` (stream-a), `../sv-B` (stream-b), `../sv-C` (stream-c), `../sv-D` (stream-d).
  Sponsor caches (`data/<sid>/raw`, `data/costar`) and `.env` are symlinked from the main checkout and
  stay gitignored.
- **Commit and push after every commit:** `git fetch origin && git rebase origin/main`, run
  `cd engine && pytest -q` and `cd web && npm test`, then `git push origin HEAD:main`; on a rejected push,
  repeat. Every finished task adds one line to `docs/CHANGELOG.md` and ticks its box below.
- **Shared files:** `engine/dr/package.py` and `web/src/types.ts` change together in one commit or not
  at all (CLAUDE.md rule 2) and are logged in `docs/CHANGELOG.md`. `engine/dr/api.py` edits are
  serialised: the controller never runs two tasks that touch `api.py` at the same time.
- **Web work** follows `docs/UI_DESIGN.md` and `web/src/styles/tokens.css` with the frontend-design skill
  (CLAUDE.md rule 13).
- **Rate limits:** if a usage or rate limit hits, drop to two streams (B with D, then A with C) instead
  of stopping.

## Order

S0 is done (scaffold, web install). P1 from `docs/CLAUDE_CODE_SETUP.md` (tokens and fonts) opens stream C.
Inside each stream: P0 first, then P1, then P2, respecting dependencies.

### Stream A: data
- [x] Task 0: pull and decision (`DEMO_SID=x37LjPx62VA`); human step (entrance and desk) folds into checkpoint (b)
- [x] Task 14: resolver, name to model, CoStar record (P1)
- [x] Task 15: arrival from Vexcel (P1, code done; pins wait on the human) — checkpoint (e): drop off and door pins
- [x] Task 17: observer view (P0; relay part touches `api.py`)
- [ ] Task 20: portfolio ranking (P1, with stream B's performance help)
- [ ] Task 19 engine half: provenance in every producer (P1)
- [ ] Task 18 P2: Showcase SDK sync (localhost only)

### Stream B: spatial
- [x] S0: scaffold
- [x] Task 1: package model, grid helpers, fixture (P0)
- [ ] Task 2: Matterport import to grid, rooms, doors, obstacles (P0) — checkpoint (a): grid preview over the floor plan
- [ ] Task 4: cane friendly planner (P0)
- [ ] Task 5: segments and score (P0)
- [ ] Task 7: build CLI (P0)
- [ ] Task 11: simulated traveller (P1)
- [ ] Task 20 help: `build_light` under 10 s per model

### Stream C: experience
- [x] P1 setup + design change: tokens, system font (human change: Apple minimal, no web fonts), contrast and glass tests (`docs/CLAUDE_CODE_SETUP.md` P1)
- [ ] Task 8: web world, audio, input, Explore, all v2 amendments, desktop, Android and iOS paths (P0) — checkpoint (c): first playable rehearsal on the clinic
- [ ] Task 9: Rehearse and pocket summary (P0)
- [ ] Task 10 web side: pointing task, quiz, coach handoff (P0)
- [ ] Task 19 web half: chips, layer meter, S key (P1)
- [ ] Task 18 P1: Showcase iframe in the observer
- [ ] Polish: reset, operator panel, accessibility check (`docs/UI_DESIGN.md` section 6)

### Stream D: agents and layout
- [x] Task 6: instruction writer (P0)
- [ ] Task 3: annotator with room labelling (P0) — checkpoint (b): panorama face calibration
- [ ] Task 10 engine side: coach rules and deep agent coach (P0)
- [ ] Task 13: orchestrator on Deep Agents, all five subagents (P0; mounts the router in `api.py`) — checkpoint (d): LangChain gate
- [ ] Task 12: layout advisor and venue view (P1)
- [ ] Optional H: BLE cane handle, only if everything else is done

### All streams
- [ ] Task 16: demo hardening (from 03:00)

## Checkpoints (the only places the controller stops and asks)

| | When | What the person sees |
|---|---|---|
| (a) | Task 2 step 5 | `data/x37LjPx62VA/grid_preview.png` (gitignored: derived from sponsor data) |
| (b) | Task 3 step 5 | the pano and the four faces to compare, then `face_yaw0_deg`; the entrance and desk for `overrides.json` |
| (c) | Task 8 done on the clinic package | URL and the keys to try with wired headphones |
| (d) | Task 13 gate | orchestrator plus subagents producing a live trace (or the scripted path, labelled) |
| (e) | Task 15 | drop off and door pins to confirm in `pick.html` |

A checkpoint pauses only its own stream; the other streams keep going.

## Safety net

- **03:00:** report every P0 task not done; P0 work takes priority over any P1 or P2 in progress.
- **04:30:** integration check (`PROMPTS.md`, "Integration check").
- **05:00:** feature freeze. Only fixes, then the "Demo freeze" prompt (`docs/DEMO.md`).
- A task that fails twice is committed behind a flag, noted in `docs/CHANGELOG.md`, and its stream moves on.

## Human decisions, 14 Nov 23:37 (binding, highest priority)

Sources: `review/agent5_interaction.md` (Hearify style interactions, O&M), `review/agent6_arrival.md`
(curb to door). Two streams, Sonnet implementers, UPDATE block after every task.

### Stream 2 (web), in order (REORDERED by the human 23:40, binding): 1 voice audition (A7a), 2 interior 3D room + full layout + A2 (STOP: screenshot to the human), 3 360 sound + sound ring + captions with direction (A4, A5), 4 Top 8 interactions (A6), 5 pre-rendered Kokoro voice + guided intro (A7b, A8), 6 outdoor scene, curb to door, fly in (A3 outdoor, A1), 7 GPS circle + day of visit (A9, drop first)
- [ ] A7a Kokoro voice: kokoro-js, onnx-community/Kokoro-82M-v1.0-ONNX, cpu, q8, `web/scripts/voice.mjs`;
      audition "Reception desk, 2 o'clock, 14 steps." in 5 English voices to `web/public/voice_audition/` — checkpoint (g)
- [ ] A1 Home: one address box, resolver, fly in from the sky onto the Vexcel ortho, pins, path, arrival line, land at the curb; walk starts at the curb
- [ ] A2 Always app voice (rule 7); captions visible
- [ ] A3 3D: outdoor (agent6 4.1.3) plus interior, one continuous curb to interior camera move; cockpit around it; Scanned view only if mesh loads under 5 s
- [ ] A4 360 sound: HRTF on every positioned sound, name clips from position, headphone tuning, outdoor audio (agent6 4.1.5)
- [ ] A5 Sound ring around the walker plus captions with direction, one event bus (agent5 section 5 `cue`)
- [ ] A6 agent5 Top 8 interactions and keymap (Q, bump, Tab/Shift+Tab, Enter beacon Explore only, W, room entry, E, approach callouts, doorway clicks; S source, Shift+S swap)
- [ ] A7b Pre render every known line and name at build to `web/public/buildings/<sid>/voice/` (gitignored, text hash); live lines via POST /api/tts, cached; browser speech if over 600 ms
- [ ] A8 UX: 10 s guided intro (Esc skips), one next action visible, 100 ms key response, any key interrupts, +/- rate, P pause, max 2 sounds, ducking, no blank screen, recovery lines, arrival chime then pointing score in words
- [ ] A9 P1: GPS error circle; day of visit page `?simgps=1` labelled simulated, disclaimer always visible
- Tests: sound direction equals ring position; caption equals spoken text; clips play from object position; plan to three.js mapping

### Stream 1 (engine), in order
- [ ] B1 Geo anchor transforms + agent6's 4 tests (incl. curb pin lands outside the building); plan_north_deg by agent6's method, labelled assumed unless verified
- [ ] B2 Curb script and recovery lines from geometry (agent6 4.1.6)
- [ ] B3 Annotator on the clinic (done 23:20: 80 cached looks, 47 landmarks after dedupe; room labels still thin) — landmark table to the human
- [ ] B4 Second demo route 40 to 60 steps to an exam room or restroom with 3+ landmarks; keep reception; merge costar.json into the package (R9)
- [ ] B5 Vexcel obliques x4 with crosshair on the door pin (data/x37LjPx62VA/raw, gitignored); try elements/detect and property/extract once each — checkpoint (f)
- [x] B6 Tasks 13, 11, 12 web, 20 live (done before this decision)

### New checkpoints
| (f) | Vexcel obliques | the 4 images plus agent6's questions: reference bearing for "1 o'clock", drive lane crossing, curb edge type, door type, canopy corners |
| (g) | voice audition | 5 clips, the human picks one |
| (c2) | new 3D experience playable | URL and keys |
