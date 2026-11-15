# Dress Rehearsal

**Practise a building before you visit it, built from 3D scans that already exist.**

HackPrinceton Fall 2026. This is the single source of truth for the project: what it is, why it is designed this way, which tracks it enters, every component, and the order we build them in. Section 10 lists the weaknesses we already know.

---

## 1. Description

Dress Rehearsal serves two users of the same building with one spatial engine.

**The visitor.** A blind or low-vision person has a first appointment at a clinic they have never visited. They type the clinic's name. The system finds the building, works out where a car should drop them, and builds a practice run from the curb to the reception desk. They hold their phone like a white cane and sweep it. It taps when it touches a wall or counter in the real 3D scan, large rooms echo, and a voice gives directions such as "desk at 2 o'clock, 14 steps." A short quiz then checks what they learned, and the next run focuses on what they got wrong.

**The venue.** A clinic, business or landlord asks where reception, waiting and public rooms should go. AI agents try arrangements, send a simulated cane traveller through each one hundreds of times, and recommend the layout where that traveller gets lost least.

**Demo building:** Julis Romo Rabinowitz (JRR) at Princeton, so a judge can rehearse it blindfolded and then walk it.

It is a rehearsal tool. It never replaces a cane, a guide dog, mobility training, or the user's own judgment.

---

## 2. First principles

We did not start from "what can we do with 3D scans." We started from what is true about travelling without sight, and derived each part of the product from it.

| # | What is true | What follows | Component |
|---|---|---|---|
| 1 | A cane only reports what is within about a metre, at this moment. It gives no preview. | Knowledge of the layout has to arrive before the visit, or from another person. | Rehearsal app (C8) |
| 2 | Blind travellers move confidently through places they have a mental map of. The first visit is the hard one: in interviews with 30 visually impaired people, unfamiliar buildings were "too difficult to attempt the first time." [1] | The product's job is to build a mental map, not to give live turn-by-turn. | Rehearsal + quiz (C8, C9) |
| 3 | Rehearsing a building by audio does transfer: blind users who explored a virtual copy of a real building then navigated the real one. [2] | The idea is sound. We do not need to prove it again; we need to make it available. | — |
| 4 | It never spread because someone had to create each building's map: by hand [2], by sending a scanning crew [3], or by filming the room in person [4]. Prebuilt maps are costly to deploy. [5] | The bottleneck is map creation. Remove it and the rest follows. | Map builder from existing scans (C2) |
| 5 | Millions of buildings have already been scanned for other reasons. | Build the map automatically from scans that already exist, so nobody has to go there first. | C2, C3 |
| 6 | The shortest path is the wrong path. Cane travellers follow walls, avoid open spaces with nothing to touch, and use landmarks. | Route planning needs its own cost function. | Cane-friendly planner (C4) |
| 7 | Blind users followed routes better when distances were given in steps than in feet or time. [6] | Instructions use step counts and clock directions, with numbers taken from geometry. | Instruction writer (C10) |
| 8 | The journey fails before the lobby: people get dropped at the wrong entrance, and large medical buildings are hard to enter correctly. [7][8] | Rehearsal must start at the curb, which needs an outside view. | Arrival planner (C11) |
| 9 | A person knows a business name, not a building ID. | Something must connect a name to a building, floor and suite. | Data resolver (C1) |
| 10 | How hard a building is to navigate is a property of its layout, and layouts can change. | The same route measurements can tell a venue how to arrange its space. | Navigability score (C5), layout advisor (C7) |
| 11 | We cannot test every instruction on real people. | Simulate a traveller with only cane-range sensing and realistic error to stress-test routes and layouts. | Simulated traveller (C6) |
| 12 | Language models are unreliable at measuring space. | Models interpret and explain; geometry code measures and decides. | System-wide rule |

---

## 3. The three data layers

| Layer | What it supplies | What breaks without it |
|---|---|---|
| **Matterport** | Point cloud and mesh (walls, obstacles). Room boundaries, door openings, room labels. Panoramas with camera positions (landmarks). Defurnished panoramas (fixed vs movable objects). | No interior to rehearse or optimise. |
| **Vexcel** | Building footprint and parcel. Oblique photos (entrance side). Elevation (steps or slope at the door). Ortho imagery (drop-off point and approach). | The journey has no start (principle 8). |
| **CoStar** | Tenant → building, floor, suite. Co-tenants as landmarks ("past the pharmacy"). Available listings, so a clinic can compare vacant suites by navigability. Company type, to find healthcare and public-facing buildings. | No way from a name to a building (principle 9), and no customer for the venue side. |

---

## 4. Tracks

| Track | Entering? | How this project fits | What we must do |
|---|---|---|---|
| **Healthcare** (required main track) | Yes | Access to care for blind patients; the demo destination is a clinic. | Lead with reaching appointments. |
| **CoStar: Inside and Out** | Yes | All three layers, each necessary; agentic loops; two real users. | Show each layer doing a visible job in the demo. |
| **Amazon Best Practical AI** | Yes | Agent that plans, acts and adapts to the user. | Working demo, named target user, documentation, pitch. Show the coach adapting. |
| **Peri Forward Deployed** | Yes | Venue side solves a real organisation's problem. | Consult a clinic, optometrist or disability services office. Record business name, person's name and role, and one piece of evidence. |
| **Best Overall** | Automatic | Creativity, utility, charity, avidity. | A main-track winner cannot also win this. |
| **LangChain deepagents** | Optional | Orchestrator, layout loop and coach as a planning agent with sub-agents. | Build the agent layer on deepagents. Confirm its features in their docs first. |
| **Best Hardware / Physical AI** | Optional | A cane handle with a motion sensor and vibration motor, linked by Bluetooth. Solves the lack of vibration in iPhone browsers. | Only if parts and a microcontroller person are available. |
| **Best Rookie** | Probably not | For first-time hackers. | Ask organisers whether the rule is per person or per team. |
| **Arlequin** | No | No fit. | — |

**Pitch emphasis by judge**
- Healthcare: stressful, missed appointments, and the blindfolded judge finding the desk.
- CoStar: "nobody has to go there first, because you already scanned it," then ranking available suites.
- Amazon: the experience, and the agent adapting to what the person got wrong.
- Peri: the organisation we spoke to and the problem in their words.
- LangChain: the agent architecture and the layout loop running live.

---

## 5. Architecture

```
            Visitor request                         Venue request
   "Appointment at X, suite 210"       "Clinic: reception, waiting for 8, 3 exam rooms"
                └───────────────┬───────────────────────┘
                                ▼
                       C12 Orchestrator agent
   ┌──────────┬─────────────┬───┴──────────┬───────────────┬─────────────┐
   ▼          ▼             ▼              ▼               ▼             ▼
 C1 Data    C2 Map       C4 Routes      C7 Layout       C8 Rehearsal   C11 Arrival
 resolver   C3 Landmarks C5 Score       advisor         C9 Coach       planner
 (CoStar)   (Matterport) C6 Simulation  (uses C4–C6)    C10 Speech     (Vexcel)
```

---

## 6. Components

Each one: input → method → output, the test that says it is done, and its main risk.

| ID | Component | Input → Method → Output | Done when | Main risk |
|---|---|---|---|---|
| **C1** | Data resolver | Business name → CoStar tenant search → property, floor, suite → Matterport model ID; Vexcel footprint by coordinates. | Three test names resolve with no manual step. | Suite or floor fields missing. |
| **C2** | Map builder | Point cloud or mesh → slice 0.1–1.8 m above the floor → 10 cm grid of free space, walls, obstacles. Room boundaries and door openings → room graph. | Grid overlays the floor plan with walls and doors aligned. | Glass and mirrors scan badly; door data may be unavailable (then detect door-width gaps). |
| **C3** | Landmarks and surfaces | Vision model labels panoramas (desk, elevator, stairs, glass door). Each label is placed in 3D by a ray from the known camera position. Furnished vs defurnished comparison marks objects fixed or movable. | 16 of 20 checked landmarks are within 1 m. | Mislabelling; low-confidence items are spoken as "possibly." |
| **C4** | Cane-friendly route planner | A* on the grid with `cost = distance + open-space penalty + turn penalty + hazard penalty − landmark bonus`. Output: segments with wall side, step count, landmarks. | Chooses a wall-following route over a diagonal across a lobby. | Weights are assumptions. |
| **C5** | Navigability score | From a route: length, share with a trailable wall, metres of open crossing, turns, decision points, hazards, landmarks per 10 m → 0–100 score shown with its parts. | Ranks five hand-picked routes as a human reviewer expects. | Weighting unvalidated. |
| **C6** | Simulated traveller | Follows the spoken instructions with cane-range sensing, heading drift and step-length error, a few hundred times → arrival rate and a map of where travellers get lost. | A deliberately vague instruction lowers arrival rate at that spot. | Error model is assumed. |
| **C7** | Layout advisor | (1) Reception placement: candidate desk positions that fit and keep doors clear, scored by C5 and C6 from each entrance. (2) Function-to-room assignment minimising visitor travel cost. (3) Fixes for an existing layout: move the desk, line up seating as an edge to follow, add a tactile strip or sound beacon. Agent loop: propose → simulate → critique → revise. | On JRR, finds a better-scoring arrangement or correctly reports the current one is near-optimal. | Guidance only, not a compliance audit; ignores power, plumbing, fire code. |
| **C8** | Rehearsal app | Web app. Phone orientation sets cane angle; a ray is cast to cane length; contact taps and vibrates; room size sets echo; landmarks are spatial sounds; speech reads directions. Modes: Explore, Rehearse, Check yourself, Pocket summary. | A blindfolded tester finishes the route and points to the destination on a printed plan. | No vibration in iPhone browsers; keyboard and audio fallbacks needed. |
| **C9** | Coach agent | Reads hesitations, wrong turns and quiz answers → finds the weakest segment → rebuilds the next run around it. | A second run after a failed quiz differs in the failed segment. | Over-fitting to one mistake. |
| **C10** | Instruction writer | Route segments → templates with clock directions, wall side, step counts. A model only smooths wording. | Every spoken number matches route data. | Wording drifts from the numbers. |
| **C11** | Arrival planner | Oblique photos → entrance side, matched to the footprint edge and the scanned interior entrance. Elevation → steps or slope. Ortho → drop-off point and a message for the driver. | Correct entrance on JRR and one sponsor-city building. | Canopies and trees hide entrances; elevation may be too coarse to count steps. |
| **C12** | Orchestrator | Plans tool calls, handles missing data, asks one question when a choice is ambiguous, states uncertainty. | Name in → rehearsal out; needs in → layout report out. | Becoming a fixed script. |

---

## 7. Roadmap

Each phase has a gate. The next phase does not start until the gate passes. Phases 1–3 are the visitor product and must stand alone if later phases slip.

| Phase | Build | Gate |
|---|---|---|
| **0. Verify data** | Real API calls for JRR and one Houston or LA building on all three layers. | We hold geometry, room data, panoramas, a CoStar record and a Vexcel footprint, or we know exactly what is missing. |
| **1. Map** | C2, C3 | Grid aligns with the floor plan; landmarks placed. |
| **2. Route** | C4, C5, C10 | Cane-friendly route with correct spoken steps on one floor. |
| **3. Rehearse** | C8 | Blindfolded tester completes the route and locates the destination. |
| **4. Simulate** | C6 | Arrival rate responds to instruction quality. |
| **5. Advise** | C7: placement, then fixes, then room assignment | Before/after result on JRR. |
| **6. Agents** | C1, C9, C12 | Name in → rehearsal out; quiz changes the next run. |
| **7. Arrive** | C11 | Correct entrance and drop-off on two buildings. |
| **8. Validate** | Sessions with blind users or a mobility instructor; the Peri consultation. | Feedback recorded and at least one change made because of it. |

**Phase 0 checklist**
- [ ] Is JRR available through our Matterport and CoStar keys? (The original data kit covered Houston and Los Angeles.)
- [ ] Does Vexcel cover Princeton, NJ?
- [ ] Does CoStar have tenant records for JRR? If not, hand-build the directory for the demo and show CoStar on a sponsor-city building.
- [ ] Can we download point clouds or meshes?
- [ ] Do our keys return room boundaries with door openings?

**Team**

| Person | Owns |
|---|---|
| A — Data | C1, C11, Phase 0 |
| B — Spatial | C2, C4, C5, C6 |
| C — Experience | C8, audio design |
| D — Agents and layout | C3, C7, C9, C10, C12, pitch, Peri consultation |

---

## 8. Demo

1. **Venue view.** JRR loads. The advisor scores the route to the current reception point, shows where simulated travellers get lost, and proposes a better position with before/after numbers.
2. **Visitor view.** A blindfolded judge rehearses the route for one minute and takes the quiz.
3. **Reality check.** The judge walks the real route, or points to the desk on a printed plan.
4. **Scale.** The same pipeline runs on a Houston or LA clinic found through CoStar.

---

## 9. Prior work and our difference

| Prior work | What it showed | Its limit |
|---|---|---|
| AbES, Harvard (2012) [2] | Audio rehearsal of a real building transfers to navigating it. | One building, modelled by hand. |
| Canetroller, Microsoft (2018) [9] | Cane skills transfer into virtual spaces. | Special hardware; invented scenes. |
| GoodMaps [3] | Live indoor audio navigation from LiDAR scans. | A crew must scan each building. |
| Hearify (hackathon project) [4] | Rehearse a room by sound from a phone video. | Someone must go there first to film it. |

**We claim:** automatic generation from existing scans; curb-to-desk coverage; routes planned for cane travel; a check on what the user learned; the same engine advising venues.

**We do not claim:** inventing audio rehearsal or the virtual cane; validation with blind users before Phase 8; replacing a cane, guide dog or training; legal accessibility compliance; that the simulated traveller predicts real behaviour.

---

## 10. Known weaknesses

1. JRR data access is unverified until Phase 0.
2. Two products in one risks diluting the visitor product.
3. Route weights and the score are our assumptions.
4. The simulated traveller's error model is invented.
5. Layout advice ignores power, plumbing, staff sightlines, fire code and cost.
6. Scans go stale as furniture and walls change.
7. Vision labelling can misplace landmarks.
8. Entrance detection from aerial photos can fail, and must match the scanned interior entrance.
9. Multi-floor journeys need elevator and stair handling.
10. A plain spoken description might give most of the benefit; we should test rehearsal against it.
11. Privacy: only public-facing spaces, within the sponsor's data terms.
12. CoStar's role on the visitor side is a directory; its stronger role (ranking listings) depends on listings linking to scans.

---

## Sources

1. Jeamwatthanachai, Wald & Wills (2019), *Indoor navigation by blind people: behaviors and challenges in unfamiliar spaces and buildings*. https://eprints.soton.ac.uk/427172
2. Merabet et al. (2012), *Teaching the Blind to Find Their Way by Playing Video Games* (AbES). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3446956/
3. GoodMaps indoor navigation. https://aph.org/how-goodmaps-is-revolutionizing-accessible-independent-travel
4. Hearify. https://github.com/ryan11yuan/Hearify
5. Snap&Nav, MobileHCI 2024. https://wotipati.github.io/projects/other_papers/MobileHCI2024_SnapAndNav/MobileHCI2024_SnapAndNav.pdf
6. Kalia et al., *Assessment of Indoor Route-finding Technology for People with Visual Impairment*. https://pmc.ncbi.nlm.nih.gov/articles/PMC3160142
7. First-person account of being dropped at the wrong entrance. https://compass.vkcsites.org/sighted-guidance-a-helpful-practice/
8. American Foundation for the Blind on finding the right office in medical buildings. https://afb.org/node/18534
9. Zhao et al. (2018), Canetroller. https://www.microsoft.com/en-us/research/?p=455112
10. Matterport Model API. https://matterport.github.io/developer-docs/api/model/overview/
