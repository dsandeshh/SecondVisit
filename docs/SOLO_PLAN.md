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
- [ ] Task 15: arrival from Vexcel (P1) — checkpoint (e): drop off and door pins
- [ ] Task 17: observer view (P0; relay part touches `api.py`)
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
- [ ] P1 setup: tokens import, self hosted fonts, contrast test (`docs/CLAUDE_CODE_SETUP.md` P1)
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
