# Demo notes

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
