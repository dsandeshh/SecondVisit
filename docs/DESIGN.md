# SecondVisit: overall design (v3)

**Make your first visit your second.** A blind or low vision patient rehearses a clinic by sound before
the appointment, built automatically from the clinic's existing Matterport scan, Vexcel aerial imagery
and CoStar records. The same measurements tell a clinic, landlord or CoStar where people would get
lost, and rank available medical suites by how easy they are to learn.

Demo building: **Medical Office, Houston** (Matterport `x37LjPx62VA`, CoStar property 5615020).
Nobody on the team has been there. That is the point.

## 1. Two users, one engine

| | Visitor (patient) | Venue (clinic, landlord, CoStar) |
|---|---|---|
| Asks | "I have a first appointment at <clinic>." | "Where should reception go?" / "Which vacant suite is easiest to learn?" |
| Gets | Curb to desk audio rehearsal, a pointing check and quiz, a coached second run, a pocket summary, a driver message | Navigability score with its parts, a lost heatmap (simulated), a better reception position, fixes, and a ranked list of suites |
| Surfaces | Rehearsal app (phone or laptop), pocket summary | Venue view, portfolio ranking |

## 2. How every sponsor resource is used

| Resource | What we compute from it | Where it shows | Tracks it scores |
|---|---|---|---|
| Matterport wall graph (`floors.vertices/edges`) | 10 cm occupancy grid: walls with real thickness, door gaps | Cane taps, routes, every step count | CoStar data use, Healthcare |
| Matterport rooms (`classifications`, `boundary`, `dimensions`) | Room polygons, labels, area | Reverb size per room, "you are entering the waiting room", quiz | CoStar, Healthcare |
| Matterport panoramas (2k skybox) | Landmarks found by the **annotator agent** (reception desk, counter, doors, seating, signs, restroom) placed by ray cast from the pano | Spatial landmark sounds, instructions ("passing the check in counter") | CoStar agent depth, LangChain, Amazon |
| Defurnished view | Fixed vs movable: an object in the furnished pano but gone when defurnished is movable and is never used as a main landmark | Landmark confidence, "chairs may move" note | CoStar data use (a feature most teams won't touch) |
| MatterPak point cloud | Furniture and fixture obstacles at cane height (0.1 to 1.8 m) not in the wall graph | Cane taps on counters, planters, chairs | CoStar data use |
| Floor plan image (origin, resolution) | Background of the observer and venue views; printed plan for the reality check | Projector, printed A3 | Demo |
| Showcase 3D tour (iframe, optional SDK) | The judges see the real place while the blindfolded judge hears it | Observer view side panel | Demo, CoStar |
| `models_index.csv` | Name or address to model; geo join to Vexcel and CoStar; candidate list for the portfolio | Resolver, portfolio | CoStar data use |
| Vexcel ortho (and oblique if available) | Drop off point, entrance side, driver message | Arrival panel, first rehearsal segment "from the curb" | CoStar data use, Healthcare |
| CoStar kit | Property name, type, class, floors, suites or listings | Resolver answer, venue table, portfolio ranking | CoStar data use, usefulness |
| Claude via LangChain Deep Agents | Planning, annotation, coaching, layout critique, uncertainty handling | Trace panel | LangChain, Amazon, CoStar agent depth |

The sponsor's own "unsolved problems" list includes understanding commercial spaces (#1) and
agentic annotation (#3). SecondVisit does both for a real medical office. Say so in the pitch.

## 3. Architecture

```
 vendor/matterport (quickstart helpers, models_index.csv)
        │
 engine/dr  (Python)                                   web/ (TypeScript, Vite)
 ┌──────────────────────────────────────────────┐      ┌──────────────────────────────────┐
 │ probe ─► data/raw/ (cached API responses)    │      │ index.html   rehearsal app       │
 │ mp_import: walls+rooms+cloud ─► OccGrid      │      │   Explore, Rehearse, Check, Summary│
 │ annotate (vision) ─► landmarks               │ JSON │ observer.html  projector view     │
 │ planner ─► segments ─► score ─► instructions │ ───► │ venue.html     layout + portfolio │
 │ simulate ─► lost heatmap                     │      │ trace panel    agent SSE stream   │
 │ layout ─► candidates, evaluate               │      └──────────────────────────────────┘
 │ resolver (index + CoStar), arrival (Vexcel)  │               ▲   SSE /api/agent
 │ cli build ─► web/public/buildings/<id>/package.json         │   WS  /ws/obs/{session}
 │ api.py (FastAPI) + agents/deep_agent.py ─────────────────────┘
 └──────────────────────────────────────────────┘
```

Rule: **geometry decides, models describe.** Code computes every distance, step count, clock hour,
score and arrival rate. Models choose, label images, ask the one clarifying question, and write short
sentences that pass `grounded()`.

## 4. Agents (LangChain Deep Agents)

One orchestrator (`DR_MODEL`) with `write_todos`, `ask_visitor` (interrupt), `finalize`, and five
subagents (`DR_FAST_MODEL`). Each tool wraps a deterministic `dr.*` function.

| Agent | Decides | Tools (code does the work) | Visible output |
|---|---|---|---|
| orchestrator | Which subagents to run, what to ask, when it is done, how to state uncertainty | `write_todos`, `ask_visitor`, `finalize`, `task` | Todo list, final answer |
| site_investigator | Which model matches the name; whether data is good enough; what is missing | `resolve_place`, `inspect_building` (data availability, map date) | `/building_dossier.md` with provenance |
| annotator | Which panoramas to look at (route first), what each landmark is, when coverage is enough | `list_panos(route_id)`, `look(pano_id, face)` (returns the image), `place(pano_id, bearing_deg, kind, label, confidence)` (code ray casts into the grid), `check_defurnished(landmark_id)` | `/landmarks.md`, landmarks in the package |
| route_planner | Destination match, the retry rung after NoRouteError | `plan_route`, `simulate_route` | `/rehearsal/route_*.json` |
| coach | Which drill fixes this person's mistakes | `get_errors`, `set_plan` | `/coach_notes.md`, the next RunPlan |
| layout_advisor | Which fix to try next, the critique | `layout_candidates`, `evaluate_layout` (max 6), `record_round` | `/venue/layout_report.md` |

Fallbacks: a scripted pipeline calls the same tools in fixed order when the model API fails (labelled
"scripted"); recorded runs replay with original timing (labelled "replay"); the coach never blocks the
next run.

## 5. Screens

1. **Home:** one text box ("I have a first appointment at the Medical Office on ... in Houston") and
   a Start button that asks "app voice" or "my screen reader".
2. **Rehearsal:** Explore (free), Rehearse (guided), Check yourself (pointing task, three quiz
   questions), Pocket summary (with the driver message). Keyboard first; phone has a full screen Step
   button.
3. **Observer (projector):** floor plan, traveller dot, cane rays, tap flashes, "what they hear" strip,
   run 1 vs run 2 pointing error, optional Showcase tour, agent trace.
4. **Venue:** current reception route, simulated lost heatmap, advisor rounds, before and after table.
5. **Portfolio:** N medical and office suites from the index, built automatically, ranked by
   navigability, with CoStar fields and build time. This is the scale moment.

## 6. Honesty labels (judges will ask)

| Kind | Examples | Label on screen |
|---|---|---|
| Measured from sponsor data | walls, rooms, areas, distances, step counts | `MP`, `VX`, `CS`, `CALC` chips |
| AI labelled | landmark kinds from panoramas | `AI` chip with confidence; under 0.6 says "possibly" |
| Assumed | route weights, score weights, step length 0.7 m | "assumed" chip |
| Simulated | arrival rate, lost heatmap | "simulated" |
| Human confirmed | entrance pin, drop off point | `HAND` chip |
| Not claimed | replaces a cane or O&M training; compliance audit; tested with blind users | said out loud in the pitch |

## 7. Demo in one line per beat (pitch script and video plan come later)

1. Type the clinic name: the agent trace resolves it, annotates landmarks, builds the route.
2. A seated, masked judge rehearses for 80 s; the room watches the observer view and the 3D tour.
3. Pointing task: error in degrees; one wrong quiz answer; the coach changes run 2 and says why.
4. Venue view: reception moved, simulated arrival up, fixes listed.
5. Portfolio: N suites built while we talked, ranked. "Nobody went there. It was already scanned."
