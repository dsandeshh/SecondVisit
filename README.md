# SecondVisit

**Make your first visit your second.**

SecondVisit lets blind and low-vision visitors rehearse a building by sound before they go. It builds the rehearsal automatically from the building's Matterport scan, Vexcel aerial imagery and CoStar property record. The first demo building is a Houston medical office.

It is a rehearsal aid. It does not replace a cane, a guide dog, orientation and mobility training, or an accessibility audit.

## What you can do

- **Arrive.** Type an address. The app flies in over the real aerial photo, places you at the drop-off point, and you walk from the curb to the door. Michael (one consistent voice) tells you where the entrance is, by clock direction and step count.
- **Explore inside, in first person.** Walk the real 3D scan of the clinic with the arrow keys. A beacon sounds from the next corner of the path to your chosen place, never through walls. It clicks when you are aimed straight at it, sounds duller when it is behind you, and pulses faster as you get closer.
- **Choose where to go.** Tab cycles the places in the building (reception desk, lab door, main entrance, then the rest). Wait 3 seconds or press Enter to set the target. Reaching it is announced and the beacon stops.
- **Rehearse.** Walk the route with no beacon to home in on, because rehearsal is the test. B gives a short hint instead.
- **Check yourself.** Three quick questions about the route you walked. Michael names your weakest stretch and offers to practise just that part.
- **Photo view.** V switches to the listing's own Matterport photos. V again returns to the scan.

Everything spoken is also shown as a caption. Distances, step counts, clock directions and scores are computed from geometry; AI is used only to name what it sees and to choose, and every AI label shows its source and confidence.

## Keys

| Key | Action |
|---|---|
| Up | Take one step |
| Left / Right | Turn 15° |
| Tab / Shift+Tab | Choose a place (auto-confirms after 3 s) |
| Enter | Go there now (in Rehearse: a hint) |
| Escape | Clear the target |
| B | Beacon on or off (in Rehearse: a hint) |
| Q | What is around me |
| E | What is ahead |
| W | Where am I |
| Space | Repeat the last line |
| C | Check yourself |
| X | Back to Explore |
| V | Photo view (the listing's own photos) |
| P | Pause |
| + / − | Speech speed |
| K or ? | Keys help |
| F6 | Move between parts of the page |

Use wired, closed-back headphones. The audio is 3D (HRTF).

## Run it

```sh
# engine API (Python 3.11+)
cd engine && .venv/bin/python -m uvicorn dr.api:app --port 8000

# web app (Node)
cd web && npm install && npm run dev        # http://localhost:5173
```

URLs:

- `/?b=x37LjPx62VA` is the clinic, full flow: arrive outside, then go inside.
- `/?b=x37LjPx62VA&flow=interior` starts inside.
- `/?b=hpGRjK5uFPW` is Office B, the second building, built by the same pipeline with no special cases.
- `/?home=story` shows the animated home page.
- `/?ui=v1` shows the earlier cockpit layout.
- `/?view=proj` is an experimental view that projects the real panoramas onto the scan. It needs a GPU.
- `observer.html` is a companion view, and `venue.html` is the layout advisor and the portfolio of Houston buildings.

Tests:

```sh
cd engine && .venv/bin/python -m pytest -q             # 261 passed, 2 skipped
cd web && npm test && npm run build                     # 627 passed
cd engine && .venv/bin/python scripts/demo_check.py --require-clinic   # 16/16, fully offline
```

## How it is built

- `engine/` (Python): imports the Matterport scan into a walkable grid with rooms, doors and obstacles. It names landmarks with a vision model and plans cane-friendly routes. It writes route instructions with grounded numbers, simulates a traveller to score each route, and computes the arrival (curb, door, clock direction) from Vexcel imagery. It then writes one building package per site. A Deep Agents orchestrator with five subagents (site investigator, annotator, route planner, coach, layout advisor) runs live, falls back to a clearly labelled scripted path, and can replay recorded runs.
- `web/` (TypeScript, Vite, three.js, Web Audio): the page-at-a-time app, the first-person scan view, HRTF audio and pre-rendered Kokoro voice clips (one voice, am_michael). Also the quiz and coach, the observer and the venue pages.
- `docs/`: `DESIGN.md`, `APIS.md`, `plan.md`, `UI_DESIGN.md`, `DEMO.md` (the click path), `HANDOFF.md` (state and history), and `CHANGELOG.md`.

## Data and honesty

Sponsor data (Matterport, Vexcel, CoStar) and anything derived from it is kept out of this repository. Each building's package, scan mesh, imagery and voice clips are built locally from cached API responses. Labels say where every fact comes from: MP, VX, CS, CALC, AI (with confidence), and HAND for human-confirmed pins. Simulated, assumed and scripted values are labelled as such.

Built at HackPrinceton, November 2026.
