# SecondVisit: rules for Claude Code

SecondVisit: "Make your first visit your second." Blind and low vision visitors rehearse any building by
sound before a first visit, built automatically from its Matterport scan, Vexcel imagery and CoStar
record. Healthcare is the lead story: the first demo building is a Houston clinic, "Medical Office",
Matterport `x37LjPx62VA`, CoStar 5615020.

Read before any work, in this order: `docs/DESIGN.md` (what and why), `docs/APIS.md` (every external
call), `docs/plan.md` (v3 tasks, interfaces, tests), `vendor/matterport/AGENTS.md` (the sponsor's own
notes for coding agents). For any work in `web/`, also read `docs/UI_DESIGN.md` (the look, components,
screens and the accessibility check) before writing UI. Your prompt names the tasks you own. Do only those. If you need something
another task owns, code against that task's **Interfaces** block; do not build it yourself.
`review/` holds the research behind the plan: read a section there only when the plan points to it.

## Hard rules

1. **Geometry decides, models describe.** Code computes every distance, step count, clock hour, score
   and arrival rate. Models may: choose (which subagent, which pano to look at, which drill, which
   fix), label images (with a confidence), ask one clarifying question, and write short sentences.
   Every model sentence that reaches a user passes `grounded()` or is replaced by its template.
   Only `DrEngine` in `engine/dr/agents/deep_agent.py` imports `dr.*`.
2. **The BuildingPackage is the contract** (`docs/plan.md`, "Shared contract", with the v2 additions).
   It lives in `engine/dr/package.py` (pydantic) and `web/src/types.ts`. Change both in one commit or
   neither, and log it in `docs/CHANGELOG.md`. The same applies to RunLog, RunPlan and PointResult.
3. **Coordinates.** The Matterport model frame is our plan frame: metres, x right, y up, z up. Never
   rotate or mirror. `heading_deg` 0 = +y, clockwise positive, [0, 360). Grid cell (r, c) centre is
   `x = origin[0] + (c + 0.5) * res`, `y = origin[1] + (r + 0.5) * res`; row 0 is the lowest y.
4. **Constants** in `engine/dr/config.py` and `web/src/config.ts`, same names and values:
   `STEP_M = 0.7`, `CANE_M = 1.2`, `GRID_RES = 0.1`, `WALL_TRAIL_M = 0.6`, `ARRIVE_M = 1.5`.
5. **Sponsor APIs are shared by every team.** Under 5 requests per second, cache every response in
   `data/<sid>/raw/`, re query signed URLs (they expire) instead of storing them, and reuse helpers
   from `vendor/matterport/matterport_quickstart.py` (`graph()`, `HttpFile`, `near()`, `equirect()`).
   The demo never depends on a live sponsor call.
6. **Platforms, in priority order.** (a) Desktop Chrome, keyboard, wired closed back headphones: the
   judge demo, always works. (b) Android Chrome: orientation sweeps the cane, `navigator.vibrate` on
   contact. (c) iOS Safari: `navigator.audioSession.type = "playback"` before the AudioContext,
   orientation after a permission tap, no vibration. Orientation needs HTTPS: use a tunnel for phones.
7. **The app is used by blind people.** Keyboard first, large high contrast text, nothing only visual.
   Nothing plays before Start. **Always app voice** (human decision 14 Nov 23:37): there is no "app voice /
   my screen reader" choice; we speak every line in one voice, am_michael (a pre-rendered clip, else `POST /api/tts` cached by the same line hash; if that fails or is slow a soft tone plays and the caption stays up; never a browser voice, never `speechSynthesis`) and captions stay
   visible, with direction ("Reception desk, 2 o'clock" plus an arrow); the caption region is
   `aria-live="off"` so screen readers do not double the voice. Speech always equals its caption (clips
   keyed by text hash). Any key interrupts speech. Phones: full screen Step button plus Repeat, Where am I,
   Recentre, Around me, Ahead, Places; never swipes. The rehearsal stage is `role="application"`; the 3D
   view is for sighted judges and companions and is `aria-hidden`. No destination beacon in Rehearse
   (Enter beacon is Explore only; in Rehearse it is the B hint). Explore: continuous target beacon on by default,
   B toggles it. Rehearse: no continuous beacon; B is the hint plus a single burst of about 3 pulses from the
   destination (human decision 15 Nov). One event bus drives audio, sound ring,
   captions and the observer. Interactions and keys follow `review/agent5_interaction.md` (Top 8, keymap
   section 6: S = source of line, Shift+S = swap channels); arrival follows `review/agent6_arrival.md`.
8. **Honest labels everywhere.** Chips `MP`, `VX`, `CS`, `CALC`, `AI` (with confidence, "possibly"
   under 0.6), `HAND` (human confirmed pins in `data/<sid>/overrides.json`). "simulated" on simulated
   numbers, "assumed" on assumed weights and the portfolio's assumed entrance, "scripted" and "replay"
   on agent fallbacks. Product copy never claims to replace a cane, guide dog, mobility training or a
   compliance audit, and never says "experience blindness".
9. **Secrets** only in `.env` (gitignored): `MATTERPORT_API_KEY`, `MATTERPORT_API_TOKEN`,
   `VEXCEL_API_KEY`, `COSTAR_KIT_ZIP` (local path to the kit zip), `COSTAR_ZIP_PASSWORD`,
   `ANTHROPIC_API_KEY`, `DR_MODEL`, `DR_FAST_MODEL`, `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`,
   `LANGSMITH_PROJECT`, optional `COSTAR_KIT_URL`, `COSTAR_API_KEY` and `MATTERPORT_SDK_KEY`. Never print,
   log or commit them. Never hard code a model id.
   Sponsor data and anything derived from it never goes into git, a public demo or a public link.
10. **TDD and small commits.** Failing test first, watch it fail, implement, pass. Before every commit:
    `cd engine && pytest -q` and `cd web && npm test`. Messages like `feat(planner): wall following cost`.
11. **Stay in your lane.** Engine work in `engine/`, web work in `web/`. Do not reformat files you don't
    own. Pull and rebase before every push.
12. **Demo freeze is 05:00 Sunday.** After that only bug fixes. If a task will overrun its timebox in the
    plan, stop, commit what works behind a flag, and report.
13. **All UI follows docs/UI_DESIGN.md and web/src/styles/tokens.css; its accessibility rules and rule 7
    win over any skill's taste.** `web_tokens.css` at the repo root is the source of truth for the tokens;
    `web/src/styles/tokens.css` is its copy, imported first in every entry file. Whenever the root file
    changes, copy it again in the same commit (`cp web_tokens.css web/src/styles/tokens.css`); the engine
    smoke test fails if the two differ.

## Repo layout

```
engine/            Python 3.11+: numpy, scipy, shapely, pydantic, fastapi, uvicorn[standard], httpx,
                   rapidfuzz, pillow, anthropic, deepagents>=0.7.38,<0.8, langchain-anthropic, langsmith
  dr/  config.py package.py grid.py fixtures.py mp_client.py probe.py mp_import.py annotate.py
       planner.py segments.py score.py instructions.py simulate.py layout.py coach_rules.py
       resolver.py arrival.py portfolio.py llm.py cli.py api.py
       agents/ deep_agent.py api_stream.py coach.py
  tests/
web/               Vite + TypeScript, no UI framework, vitest
  index.html observer.html venue.html pick.html
  src/ main.ts types.ts config.ts world.ts clock.ts
       audio/ engine.ts cane.ts echo.ts landmarks.ts speech.ts haptics.ts space.ts taps.ts
       input/ keyboard.ts orientation.ts
       modes/ explore.ts rehearse.ts quiz.ts point.ts summary.ts
       observer/ protocol.ts bus.ts observer.ts   venue/ venue.ts   trace/ panel.ts   pick/ pick.ts
  public/buildings/<sid>/package.json arrival.jpg floorplan.jpg   public/portfolio.json
vendor/matterport/ sponsor quickstart: matterport_quickstart.py .ipynb, models_index.csv, AGENTS.md, basemap.json
data/<sid>/        raw/ (cached API responses, gitignored), overrides.json (committed)
data/fixtures/     small test fixtures (committed)
traces/            recorded agent runs for replay
docs/              DRESS_REHEARSAL.md DESIGN.md APIS.md plan.md UI_DESIGN.md CLAUDE_CODE_SETUP.md DATA_STATUS.md
                   CHANGELOG.md DEMO.md (PITCH.md comes later)
web_tokens.css     design tokens, source of truth (copied to web/src/styles/tokens.css)
review/            research reports and the tested deep agent skeletons (review/langchain/)
```

## Commands

- Engine tests: `cd engine && pytest -q`; web tests: `cd web && npm test`
- Pull sponsor data: `cd engine && python -m dr.probe pull --model x37LjPx62VA`
- Build the clinic package: `cd engine && python -m dr.cli build --source matterport --model x37LjPx62VA --out ../web/public/buildings/x37LjPx62VA/package.json --sim 300`
- Portfolio: `cd engine && python -m dr.cli portfolio --city Houston --n 20 --out ../web/public/portfolio.json`
- API: `cd engine && uvicorn dr.api:app --reload --port 8000`; web: `cd web && npm run dev`
- Rehearsal with observer: `/?b=<sid>&obs=demo` and `/observer.html?b=<sid>&obs=demo` (add `&relay=1` for a phone, `&op=1` for the operator panel)
- Phone over HTTPS: `cloudflared tunnel --url http://localhost:5173`
- Demo audio: wired closed back headphones only; recheck the output device after plugging in HDMI.
- Note: the Matterport Showcase SDK runs on localhost only. Allowlist only `localhost` and the dev
  port on `MATTERPORT_SDK_KEY`; never load the scripted tour from a tunnel or any public host.
