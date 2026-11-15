# Demo notes

## Click path (about 4 minutes)

Setup: wired closed back headphones, Chrome, `cd engine && .venv/bin/python -m uvicorn dr.api:app --port 8000`, `cd web && npm run dev`.
Open three tabs: `/?b=x37LjPx62VA&obs=demo` (walker), `/observer.html?b=x37LjPx62VA&obs=demo` (projector), `/venue.html?b=x37LjPx62VA`.
**New shell (behind a flag):** add `&ui=v2` for the page-at-a-time journey described in "The v2 journey" below; without it the cockpit flow below is unchanged. To make v2 the default change `DEFAULT_UI` in `web/src/pages/ui.ts` from `"v1"` to `"v2"` (one line; `?ui=v1` still gets the cockpit).
Add `&flow=full` to the walker URL for the whole story (Arrive tab: fly in from the sky, curb to door) once the outdoor hook is in;
without it the app opens inside, so the demo never depends on it. Add `&intro=1` to force the guided intro again.

1. **Home.** Press Start (Enter). Nothing plays before it. We speak every line in one voice (app voice, always); captions stay up with a direction arrow.
2. **Guided intro.** The big prompt asks for Up, then Left or Right; Esc skips it. Next action line (bottom right) says what to press next.
3. **Explore.** Walk with the arrows. The Top 8 keys: Q around me, E ahead, Tab choose a place, Enter go there (beacon), W where am I,
   Space repeat, S source of the line, K the keys read aloud. F6 moves between top bar, stage, Keys, Agent and data. Esc leaves the stage.
   Show the 3D view (Behind, Top, Orbit), the objects list (rename, remove, add) and the chips: `MP VX CS CALC AI HAND`.
4. **Rehearse.** Enter on "Start rehearsal". One stretch at a time; B is the hint (no beacon here). Walk to the reception desk; the arrival chime and the score in words.
5. **Check yourself.** Pointing task, then three quiz questions (1 to 4). Then the pocket summary and Copy driver message.
6. **Projector.** In the observer tab: the walker, route, cue rings (sound ring equivalents), the Showcase tour (localhost only) and the Run 1 vs Run 2 table.
7. **Venue.** `Layout` opens with the saved report (replay). Press Run layout advisor for the live agent (about 25 s; falls back to scripted). `Portfolio` shows the ranked suites.
8. **Agent and data panel** (below the fold): Ask the agent for the visitor route; trace plays.

## Every fallback and its label

| Fallback | Where it shows | Label |
|---|---|---|
| Agent model unreachable or over 45 s | Agent trace, venue trace | `scripted` |
| Agent recording played instead of a model call (`/api/agent/replay?name=visitor|venue`) | trace, venue tab | `replay` |
| Saved `layout_report.json` shown on Layout load, or when the agent stream is offline | venue Layout | `replay` |
| Arrival rate, lost heatmap, run counts from the simulated traveller | Venue, summary, observer | `simulated` |
| Portfolio entrance and weights | Portfolio | `assumed` |
| Landmark under 0.6 confidence | objects list, 3D labels | `possibly`, chip `AI 0.xx` |
| Human confirmed pin | chips | `HAND` |
| No pre-rendered clip for a line | rendered by `/api/tts` (am_michael), caption shows at once | none; if the engine is down, a soft tone and the caption only |
| Matterport tour or SDK not on localhost | observer tour box | text only, tour not loaded |
| Floor plan image or json missing | observer, venue | note under the plan |
| `scan.glb` missing or over 5 s (gitignored, local) | 3D view | note "Real scan not available ... Showing the built plan", Plan button |
| Outdoor hook absent | walker | app opens inside; no Arrive tab |
| No portfolio.json (sponsor data, not committed) | Portfolio | "No portfolio has been built yet" with the build command |


## Agent trace (Task 13, checkpoint d)

Live run on the fixture, `DR_MODEL`/`DR_FAST_MODEL` from `.env`, 2026-11-14 23:15: visitor request ("appointment at the front desk of
the fixture lobby") took about 19 s: site_investigator (inspect_building) then route_planner (plan_route, simulate_route) then
finalize, mode `agent`. Venue request ("Where should our reception desk go?") took about 25 s: site_investigator then
layout_advisor (layout_candidates, evaluate_layout, record_round), kind `layout`. Simulation is labelled "simulated (stub)"
until Task 11 lands. Traces are written to `traces/<thread>.jsonl` (gitignored; replay with
`GET /api/agent/replay?name=<file>`). Public LangSmith link: not captured yet.

Playing the recordings (no model or sponsor call): `GET /api/agent/replay?name=visitor` (appointment at the front desk) and
`?name=venue` (Where should our reception desk go?); `&speed=4` plays faster; `GET /api/agent/replays` lists which file each name
resolves to. The local clinic recordings (`traces/replay-*-clinic.jsonl`, sponsor derived, gitignored) win when present, otherwise
the committed `traces/replay-*-fixture.jsonl` play. The stream's start event says `mode: "replay"`.


## The v2 journey (`?ui=v2`, hash routes, one full screen page at a time, no scroll)

`/?b=x37LjPx62VA&ui=v2` (add `&flow=interior` to open inside). Each page speaks its purpose in Michael's voice on arrival.

1. `#/home`: "SecondVisit", one address box, Start (first Tab stop), the available buildings as buttons. Nothing plays before Start.
2. `#/arrive`: fly in, then the outdoor curb to door scene; only a small Pause. At the door it moves to `#/inside` by itself.
3. `#/inside`: the locked rehearsal. First person on the real scan mesh (eye height, the walker's own position and heading, no capsule), offline, from the first frame; Matterport is never loaded unless the visitor presses V. V: photo view, the listing's own photos (stream 1's showcase; if it fails, back on the mesh with the calm note); V again: scan view. No third person view. Only the sound ring (top left), one caption line, the mini map, Pause and Help. `/` still swaps Real scan and Plan, both first person. Enter starts the rehearsal; keys as before (Top 8, Tab, B, Esc, F6, P, plus and minus).
4. `#/check`: pointing test, then the quiz (keys 1 to 4, R, Enter).
5. `#/summary`: the score in big words, run 1 against run 2, Practice again, How it was built.
6. `#/about` ("How it was built", for judges; also K and Help open it): data source chips with tooltips, objects list (spoken names, Rename and Remove on the selected row only), agent trace, session facts, provenance, the keys, the pocket summary. Esc goes back.
