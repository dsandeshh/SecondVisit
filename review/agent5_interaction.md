# SecondVisit review 5: interaction design for spatial exploration and wayfinding

Reviewer: agent 5 (interaction research and catalogue). Written Saturday night, about 23:30 ET, for the 3D room view now being built and the existing Explore and Rehearse modes.
Inputs read: `docs/DESIGN.md`, `review/agent3_experience.md`, `review/plan_v2.md` (BuildingPackage contract, Task 8 interfaces), `ui-pack/UI_DESIGN.md` (stage keys), and the full Hearify source (cloned at depth 1 from https://github.com/ryan11yuan/Hearify).

Priority labels follow agent 3: **P0** tonight (before 03:00), **P1** if time before the 05:00 freeze, **Later** (say it in the pitch). Effort: **S** under 30 min, **M** 30 to 90 min, **L** over 90 min, for one coding agent who already has the audio engine, `World.raycast`, `World.roomAt` and the speech queue.

Everything here is for **rehearsal at home**. No interaction claims to replace a cane, guide dog, human guide or O&M training. Interactions that would need live positioning in the real building are marked **LIVE** and are not built tonight.

---

## 0. The short version

Top 8 for tonight, in build order:

| # | Interaction | Keys (phone) | Hear | Judges see | Effort |
|---|---|---|---|---|---|
| 1 | Around me sweep | Q (button "Around me") | Up to 6 nearest landmarks, each name spoken from where it is, clockwise from straight ahead, 250 ms apart | A blue wedge turns clockwise around the traveller and stops on each item as it speaks; label chip and list row light up | S |
| 2 | Collision thud plus name | Up into something | Low thud with a click from the contact point, then "counter" or "wall" from the same point | Orange ring bursts at the contact point; strip says "Bump: check in counter" | S |
| 3 | Place picker and beacon | Tab / Shift+Tab, Enter, Esc ("Places" list, then a place button) | Name from its position plus "Reception desk, 2 o'clock, 14 steps"; Enter starts a pulse that speeds up as you close in and brightens when you face it; chime on arrival | Ripple rings leave the target in time with each pulse; dashed path to it; wedge goes solid when facing within 15 degrees | M |
| 4 | Where am I | W ("Where am I", exists) | "Waiting room, about 8 by 6 metres. Facing the reception desk, 5 steps. Nearest door at 4 o'clock, 3 steps, to the corridor." then the door name from the door | A clock face (12 ticks) appears on the floor around the traveller; mentioned items get their hour labels; mini plan zooms to the room | S |
| 5 | Room entry with room size reverb | automatic | Two soft jamb clicks as you pass the doorframe, the echo changes over 300 ms, then "Waiting room, about 8 by 6 metres" | Room floor tints in, room chip shows `MP` and "echo 0.7 s `CALC`" | S |
| 6 | Ahead of me cone | E ("Ahead") | Up to 5 things inside ±30 degrees, nearest first, from their positions, then "Wall ahead in 6 steps" | A 60 degree light cone in front of the traveller, items inside it outlined, a ray to the first wall with a step label | S |
| 7 | Landmark callouts on approach | automatic | Within 2.5 m: the landmark's name from where it is, once per approach; "Passing the pharmacy on your right" on route stretches | Label chip pops and a thin leader line joins it to the traveller; list row gets a "passed" tick | S |
| 8 | Doorway cues | automatic, O to find the nearest door | Two clicks, one from each jamb (width and position in one sound), then "Doorway at 1 o'clock, 3 steps, into the corridor"; holding O pings the nearest door faster as you approach | The door frame in 3D glows, width label "1.1 m `MP`" | M |

Three design insights that should shape every choice below:

1. **Free exploration builds a map; a homing beacon builds a habit.** In the AbES study, blind people who learned a real building through a free exploration game and those taught routes by a facilitator transferred routes equally well (about 85 to 92 percent correct), but the gamers were far better at finding the shortest exit from an unexpected drop off point (2.71 vs 1.66 points out of 3) [R1]. GPS turn by turn users made more errors and sketched poorer route maps than map users [R14]. So the beacon is a tool in **Explore**, logged as a hint in **Rehearse**, and every beacon arrival is followed by a pointing question with the beacon off.
2. **Say the name from where the thing is.** Hearify, Seeing AI's World channel and Soundscape all place the spoken name at the object's real position, so direction is heard, not described [H, R5, R2]. Browser speech cannot be panned, so tonight's single most valuable asset is a folder of pre rendered name clips (`say` on the Mac, 10 minutes, script in section 4.1).
3. **Mirror how O&M instructors teach a room.** Room familiarisation starts from a base point by the door, trails the perimeter, then crosses in a grid [R9]; landmarks are things that do not move, clues are temporary [R10, R11]. In a haptic audio virtual room, blind learners used the perimeter, object to object and grid strategies and then found target objects in the real room unaided 81 percent of the time vs 40 percent for people who explored the real room only [R8]. Our interactions map one to one: wall trailing (perimeter), Tab and beacon (object to object), Ahead cone (grid), Home key (base point), and movable things are never main landmarks.

---

## 1. Hearify, read in full

Source: https://github.com/ryan11yuan/Hearify, files under `src/lib/explore/`, `src/lib/audio/`, `src/lib/viewer/ExploreController.ts`, `src/components/ExplorePanel.tsx`, spec `docs/superpowers/specs/2026-10-08-hearify-sound-rehearsal-design.md`, `docs/demo-script.md`. Every number below is read from the code, not the README.

### 1.1 Explorer controls (`explore/keys.ts`, `explore/walk.ts`)

| Key | Action | Detail |
|---|---|---|
| W / S | step forward / back | `STEP_M = 0.5`; footstep sound; held key repeats on its own clock every `REPEAT_MS = 500` (about 1 m/s); the browser's key repeat is ignored (`e.repeat` dropped) |
| A / D | turn left / right | `TURN = π/6`, one clock hour (30 degrees) per press; also repeats when held |
| Space | scan | restarts if pressed again |
| Tab / Shift+Tab | next / previous target | order recomputed from where you stand on every press |
| Enter (and NumpadEnter) | go to chosen target | with none chosen, the first target is chosen and gone to |
| Esc | stop | says "Stopped." |
| H | help | "W and S walk. A and D turn. Space: what's around you. Tab: choose a place. Enter: go there. Escape: stop. H: these keys again." |

Keys with Ctrl, Alt or Cmd are left to the browser. Window `blur` releases held keys (keyups never come). Any action other than a step or turn cuts off a running scan and the narrator; moving keeps the scan playing so the names stay put while the ears move (`ExploreController.perform`).

### 1.2 Walking and the collision thud (`walk.ts`, `session.ts`)

- Blocked if the step would end within `WALL_GAP_M = 0.3` of a fitted wall, or inside a blocking object's footprint grown by `BODY_M = 0.1` (reduced from 0.25 because it split the floor into islands). A box you are already inside never blocks, so you can always step out.
- On a block: no move; effects `[thud at contact point, name clip at the same point]`, run in order (the clip waits for the thud to finish). Contact point is the nearest point of the blocker at `CONTACT_HEIGHT_M = 1`. A wall within `DOOR_REACH_M = 0.5` of a door's footprint says "door" instead of "wall".
- Non blocking names (door, window, TV, whiteboard) never stop you.

### 1.3 Scan (Space) (`scan.ts`)

- Group same name objects whose centres are within `GROUP_M = 1.5` of another (single link union find). A group of one plays the singular clip ("chair"), larger groups the plural ("chairs"), from the mean of the centres.
- Order: clockwise bearing from straight ahead (0) round to just under 360 degrees. No range limit, no line of sight test (one room).
- Pacing: each clip starts `SCAN_GAP_MS = 250` after the previous one ends. Caption builds up as "Door · Chairs · Table · TV".

### 1.4 Place cycling and the guidance pulse (`scan.ts targetOrder`, `beacon.ts`, `ExploreController.frame`)

- Targets: one per name present, the nearest of that name. Order: door first, then stairs, then by footprint distance, ties by name order.
- Choosing plays the target's clip from its position, then narrator: "Door, 2 o'clock, about 4 metres."
- Go: a pulse from the target's box centre, interval `min(1.2, 0.25 + 0.15 × d)` seconds where d is floor distance to the footprint edge. So 0.25 s at contact, 0.4 s at 1 m, 1.0 s at 5 m, capped at 1.2 s beyond about 6.3 m. Checked every animation frame against `performance.now()`.
- Arrival at `ARRIVE_M = 1` m: chime, "You're at the door.", pulse stops. Choosing another target while going switches the pulse.
- There is no on axis cue: the pulse sounds the same whether you face it or not; direction comes from HRTF alone.

### 1.5 Wording (`words.ts`, `geometry.ts`)

- Clock hour = `round(bearing / 30°) mod 12`, 0 said as 12; bearing to the box or group centre.
- Distance: under 1 m "less than a metre"; under 3 m to the half metre; else whole metres, always "about".
- Intro: "A room about 5 by 3 metres, with 1 door, 10 chairs, 3 tables, 1 TV and 1 whiteboard. You're at the starting point. The nearest door is at 6 o'clock, about 1.5 metres. Press H for help."

### 1.6 Audio engine (`audio/spatial.ts`, `audio/sounds.ts`, `audio/narrator.ts`, `explore/echo.ts`)

- One `AudioContext`, created inside the Start click; all 32 name clips fetched and decoded before exploring starts (fail = "Couldn't load the voices.", exploring does not start).
- Spatial sounds (clips, pulse, thud): `BufferSource → PannerNode{HRTF, inverse, refDistance 1, rolloffFactor 0.6} → dry gain → master`, and each panner also feeds an echo send at `-10 dB`. Footsteps and chime are not spatial (in the head) but still go to the echo.
- Listener follows the explorer at `EAR_HEIGHT_M = 1.5`, using the AudioParam form when present, else `setPosition / setOrientation`.
- Made in code, mono, normalised, 2 ms raised cosine edges:
  - footstep: 80 ms one pole low passed noise (600 Hz), envelope `exp(-t/0.02)`, peak 0.5;
  - thud: 250 ms, 70 Hz sine, `exp(-t/0.05)`, peak 0.8;
  - pulse: 120 ms, 880 Hz sine, 5 ms attack, `exp(-t/0.03)`, peak 0.5;
  - chime: 600 ms, 660 Hz `exp(-t/0.12)` plus 990 Hz from 150 ms `exp(-(t-0.15)/0.15)`, peak 0.6.
- Echo: one `ConvolverNode`, stereo IR from Eyring reverb time per octave band over the fitted box (drywall walls, carpet floor, plaster ceiling, plus "some furnishing" absorption), late tail of band filtered decaying noise with independent L and R seeds, 1.5 × the longest band time, capped at 2 s with a 100 ms fade. Fixed per room; does not change near walls.
- Narrator: browser `speechSynthesis`, local English voice preferred (`localService`), rate 1.05, each line cancels the previous. Captions in an `aria-live="polite"` region.
- Name clips: Kokoro TTS rendered offline to `public/voices/<clip>.wav`, silence trimmed. This is what makes "each object says its name from where it really is" possible.

### 1.7 Helper check screen (`ExplorePanel.tsx`, `checked.ts`, `LabelsOverlay.ts`)

- Panel top right: room line ("About 4.6 × 3.3 × 2.4 m"), finding status, one row per object ("Chair 1", "Chair 2") with a rename `<select>` of the 16 names and a Remove button, "Add an object" (next click on the floor places a default size box), "Start exploring", "Use headphones."
- Hover or focus a row and its floating 3D label chip turns teal. While exploring, the current target's chip is teal. Every change is saved (`PUT .../checked`), one save in flight, newest list wins.
- Explore mode panel: "Exploring", a one line key reminder for onlookers (`W S walk · A D turn · Space scan · Tab choose · Enter go · Esc stop · H help`), Stop exploring, big caption bottom centre.

### 1.8 What to take, what to change for SecondVisit

| Hearify choice | Keep | Change for SecondVisit, and why |
|---|---|---|
| Name clips spatialised from the object | Yes, the core of "very interactive" | Our labels come from the package; render clips per building (section 4.1) |
| Clockwise scan from ahead, 250 ms gaps, grouping 1.5 m | Yes | A building, not a room: limit to the 6 nearest within 8 m with line of sight, so the sweep stays under 6 s |
| Tab order doors first | Yes | Our order: today's destination first, then exits and doors, then desk, restroom, elevator, then by distance |
| Pulse rate from distance | Yes | Add the Soundscape on axis brightening (1.4 below 15 degrees); aim the pulse at the next corner of the path, not through walls |
| Thud then name | Yes | Add a noise click to the thud: a 70 Hz sine alone is poorly localised |
| Fixed echo per room | Yes | Crossfade per room as you walk (agent 3, 1.7); jamb clicks at thresholds |
| W/S/A/D, Space = scan | No | Our stage already uses arrows to walk, Space to repeat, W for Where am I, A/D to sweep the cane. New keys go on Q, E, Tab, Enter, Esc, O, T, G, P, L, K, [ and ], Home |
| Turn 30 degrees | No | Ours turns 15 degrees (Task 8); clock words still use 30 degree hours |
| Arrival at 1 m | No | `ARRIVE_M = 1.5` (CLAUDE.md rule 4) |
| Not tested with blind users, says so | Yes | Same honesty line in our pitch |

---

## 2. Prior art and practice, with sources

### 2.1 Products

**Microsoft Soundscape** (now continued as open source by the Scottish Tech Army).
- Beacon: "a steady drumbeat in the direction of the location of the beacon"; when you face it "a steady beep will play along with the beat"; it does not get louder as you approach [R3]. The app picks a different looping sample by the angle between your facing direction and the beacon; most styles use bands 0 to 15 degrees ("A+"), 15 to 55, 55 to 125 and 125 to 180 ("behind"); the original style used on axis 0 to 22.5 vs off axis [R4]. With no direction available the beacon goes quieter [R2].
- Callouts while walking, in priority: distance to destination, upcoming intersection, the 5 nearest points of interest; repeat limits 60 s, 30 s and 60 s; callouts stop when you stop [R2]. Voices speak "from the position of the point of interest" [R3].
- Buttons: **My Location** says the direction you face then where you are, for "when you step off a bus, leave a building or lose your bearings" [R6]. **Around Me** calls out up to four places, one ahead, right, behind and left, each from its direction with its distance [R7]. **Ahead of Me** announces up to five places in front of you [R7b]. Route playback puts the beacon on the first marker and moves it to the next when you get close [R2]. Street Preview lets you "familiarize and build a mental map of the space" before going [R13].

**BlindSquare.** Announces the nearest places with distance and direction on launch, radius set by a slider; **Look Around**: point the top edge of the phone and you hear a sound when you face a new direction, then the places that way; shake to exit [R15].

**Seeing AI, World channel.** Uses LiDAR; each object's name is spoken from its direction and moves behind you as you turn; objects collect into a list, and choosing one starts guidance with 3D sound and beeps [R5].

**Apple Magnifier Door Detection.** Speaks the distance to the door; feedback gets more frequent as you approach and the pitch rises within a set distance; optional attributes: door size, how to open it, whether it is open; optional text and signs near the door, such as a restroom sign. Apple warns: "Don't use Door Detection for navigation or in circumstances where you could be harmed or injured." [R16]

**NaviLens.** Codes read from up to about 100 ft, at a 160 degree angle, in 1/30 s, without aiming [R17]. LIVE: needs codes on site.

**GoodMaps Explore.** Camera based positioning inside mapped buildings, turn by turn "within one meter of accuracy", and you can browse a building's destinations remotely before visiting [R18]. LIVE for guidance.

**Lazarillo.** Radio like announcements of nearby places while moving, category search, and a simulation mode to "simulate anywhere, plan routes, save favorites, and explore" [R19].

**Aira.** Remote visual interpreters. "The last 50 feet": they describe the layout, your walking angle and where the door handle is; pre trip planning through a large medical complex, saved for the next interpreter [R20]. This is the human version of our curb to door beat, and the pre trip planning is exactly our use case.

### 2.2 Research

- **AbES, Connors, Chrastil, Sánchez, Merabet 2014** [R1]: space bar walks, J and L turn, K opens doors, F reports location; each virtual step is about one real step; iconic spatialised sounds (a door knock in the ear on the door's side), a jewel sound that grows louder as you approach, rising pitch on stairs, speech for location and heading. Two story building, 23 rooms. Gamers (free exploration, n = 15) vs directed navigators (n = 14) vs control (wrong building, n = 7): routes transferred to the real building for both (physical route task 87.5 vs 88.6 percent for early blind); drop off task to the nearest exit 2.71 vs 1.66 points out of 3, p < 0.001; controls scored zero.
- **Canetroller, Zhao et al. CHI 2018** [R12]: brake that stops the virtual cane at objects, vibration recorded from a real cane, 3D contact sounds recorded at a cane tip by material. All 9 cane users found the door, table and bin; 8 of 9 pointed to all correctly; shorelining, two point touch and constant contact all carried over. One participant could not tell the wall sound from the door sound; participants asked for echo and more environmental sound.
- **Lahav and Mioduser 2008** [R8]: a multisensory virtual room with object names, bump sounds, corner announcements and footstep timing. Learners used perimeter, grid, object to object and reference point strategies, and invented "constant scanning" that is only possible in a virtual room; 81 percent found target objects in the real room unaided vs 40 percent of controls. BlindAid follow up: the perimeter strategy dominated (75 to 100 percent) [R8b].
- **Guerreiro et al. ASSETS 2017** [R21]: virtual navigation of a real route on a phone. VirtualWalk (step by step, 0.7 m steps with a step sound) vs VirtualLeap (jump to the next intersection or POI). Walk gave more accurate route sequences (10 of 13 vs 8 with no sequence errors) and was faster to learn (413 vs 540 s); all participants then reached the real destination. Double tap repeats the instruction, triple tap returns to the start, fast forward walks at 0.2 s per step. Implications: offer both walk and leap; give speed control; help estimate distance; manage information load.
- **Parseihian et al. 2016** [R22]: for audio guidance to a target, pitch gave the fastest approach and tempo was about as precise; loudness and brightness were worst; a distinct reference sound at the target cut overshoot (75 vs 44 percent of trials overshot).
- **Kolarik et al.** [R23]: reverberation makes listeners judge a virtual room larger; blind listeners' judgments of room size and sound distance are more strongly linked than sighted listeners'. Room echo is information, not decoration.
- **Ishikawa et al. 2008** via BPS digest [R14]: GPS users walked further, stopped more and drew poorer route sketches than map users; people walked along the route first did best.

### 2.3 O&M practice the interactions copy

- **Trailing**: "Using the cane and / or the hand to lightly follow along a surface", to find your place, locate objectives and keep a parallel line of travel [R10]. **Shoreline**: following a curb, building side or sidewalk edge by touch [R11].
- **Squaring off**: "Placing one's backside against an object in order to obtain a perpendicular line of direction" [R10].
- **Drop off lesson**: the student is taken to a point inside a familiar environment and must work out where they are [R10].
- **Landmark**: "An object that usually does not move and is used to identify a particular location" [R11]. Clues are temporary, landmarks permanent [R9b].
- **Room familiarisation**: verbal description first; stand on the handle side of the door; the base point by the door that you return to; trail one wall to a corner and back; then square off and cross the room in a grid [R9].
- **Clock face directions** let a person turn toward a target precisely without being physically moved [R24].
- **Human (sighted) guide**: grip just above the elbow, the traveller half a step behind; say which way a door opens and on which side; single file in narrow spaces; say step up or down and pause; at stairs say when the last step comes; at a seat describe it and place their hand on its back; plain words ("left", "straight ahead") and not too much talk; before leaving, make sure they know where they are and say you are going [R25].

---

## 3. Interaction catalogue

Conventions for every row:
- Plan frame metres, `heading_deg` clockwise from +y (CLAUDE.md rule 3). `bearing` is clockwise from the traveller's heading in [0, 360). `clock = round(bearing / 30) mod 12`, 0 said as 12. Steps = `round(d / STEP_M)` with `STEP_M = 0.7`; under one step say "within reach".
- "Item" = a `Landmark` (with `fixed`, `confidence`), a `Door` (at the midpoint of `a` and `b`), or an `Entrance`.
- Line of sight `los(p, q)`: walk the grid from p to q at 0.1 m; blocked by code 1 (wall). Glass (4) does not block hearing or low vision sight. Items in the same room as the traveller always pass.
- Every spoken line is a template filled by code (rule 1). Labels with `confidence < 0.6` are read with "possibly" (rule 8). Items with `fixed: false` are said with "may move" and never used as callout landmarks.
- Mode column: **Ex** = Explore (free), **Re** = Rehearse (guided, sensory honest). In Rehearse, anything marked "hint" is logged as a `hint` event for the coach.
- Every interaction publishes one `cue` message for the 3D view and the observer (section 5), so the 3D screen never needs its own logic.

### 3.1 Catalogue table

| # | Name | User does (key / phone) | User hears | Judges see on the 3D screen | Why it helps (source) | Mode | Effort | Priority |
|---|---|---|---|---|---|---|---|---|
| 1 | **Around me sweep** | Q / "Around me" button. Shift+Q: the same with clock and steps after each name | Rising 120 ms sweep chirp in the head, then up to 6 nearest items within 8 m with line of sight, ordered clockwise from 12 o'clock, each name clip from its position, 250 ms gaps; same kind within 1.5 m grouped ("chairs"). Shift+Q adds "2 o'clock, 5 steps" after each | A 30 degree translucent blue wedge (`--d-route` 20 percent) rotates clockwise from the heading and parks on each item as it speaks; its label chip and objects list row highlight; strip builds "Desk · Door · Chairs" | Hearify Space scan [H]; Soundscape Around Me [R7]; clock face practice [R24] | Ex; Re hint | S | **P0** |
| 2 | **Ahead of me cone** | E / "Ahead" button | Up to 5 items inside ±30 degrees within 12 m, nearest first, name from position plus steps; then the free distance straight ahead from `raycast`: "Wall ahead in 6 steps" or "Open for 9 steps, then a wall" | 60 degree light cone on the floor in front of the traveller, items inside outlined, a ray to the first hit with its step count `CALC` | Soundscape Ahead of Me [R7b]; grid strategy [R8]; open areas are the hardest stretches (agent 3, 3.2) | Ex; Re hint | S | **P0** |
| 3 | **Place picker** | Tab / Shift+Tab (phone: "Places" opens a list of real buttons) | Name clip from its position, then "Reception desk, 2 o'clock, 14 steps." Order: today's destination, exits and doors, desk, restroom, elevator, then by distance; recomputed per press | Picked item's chip turns blue and grows; list row selected; distance badge | Hearify Tab [H]; Seeing AI object list [R5] | Ex, Re | S | **P0** |
| 4 | **Beacon guidance** | Enter after Tab (phone: tap a place button); Esc stops ("Stop" button) | Pulse from the next corner of the path to the target, interval `min(1.2, 0.25 + 0.15 d)` s; brighter double partial when facing within 15 degrees; duller and darker behind; two ticks when a corner is passed; chime and "You're at the reception desk, at 12 o'clock, within reach" at 1.5 m | Ripple rings leave the beacon point at each pulse (same clock as the audio); dashed path from traveller to target; the facing wedge turns solid inside 15 degrees | Hearify pulse [H]; Soundscape on axis beat and route markers [R3, R4, R2]; tempo and a reference cue reduce overshoot [R22] | **Ex only**. In Re, Enter = B: three chirps from the destination, logged as hint (agent 3 rule) | M | **P0** |
| 5 | **Collision thud plus name** | Walking into something (Up) | Thud (70 Hz body plus a short noise click) from the contact point, then the name clip from the same point: "wall", "glass", "check in counter", "chair, may move". Same blocker within 2 s: thud only. Android: 150 ms vibration | Orange (`--d-obstacle`) ring bursts at the contact point for 300 ms; strip "Bump: check in counter" | Hearify thud then name [H]; Canetroller: blocking at objects let users feel boundaries [R12] | Ex, Re | S | **P0** |
| 6 | **Where am I** | W / "Where am I" (exists, extend) | One or two lines: room and size; what you face ("Facing the reception desk, 5 steps" or "Facing a wall, 3 steps"); nearest door with clock, steps and where it leads; in Rehearse the current stretch ("Stretch 2 of 6: 12 steps, wall on your left"); then the nearest door's name clip from the door | Clock face of 12 ticks on the floor around the traveller, aligned to heading; mentioned items get hour labels; mini plan zooms to the room | Soundscape My Location: direction first, then place [R6]; "lose your bearings" use [R6] | Ex, Re | S | **P0** |
| 7 | **Room entry with room size echo** | Automatic when `roomAt` changes (2 step hysteresis, or at once when crossing a `Door` segment) | Jamb clicks as you pass the frame; echo crossfades to the new room over 300 ms (footsteps ring longer in the lobby); "Waiting room, about 8 by 6 metres." plus the room's main fixed landmark with clock | Room floor polygon tints in, room chip with `MP` and "echo 0.7 s `CALC`"; objects list filters to the room | Reverb carries room size, more so for blind listeners [R23]; participants asked for echo [R12]; corners and rooms announced in Lahav's VE [R8] | Ex, Re | S | **P0** |
| 8 | **Landmark callouts on approach** | Automatic | When a fixed landmark comes within 2.5 m with line of sight: its name from its position, once per approach (re arm after 4 m away), at most one callout per 4 s. On route stretches, crossing a `landmarks_passed` item: "Passing the pharmacy on your right". Sounding kinds (desk murmur, elevator ding, water hum) fade in from 6 m, max 2 at once (agent 3 budget) | Chip pops (scale 1.15, 200 ms), a thin leader line to the traveller; list row "passed" tick | Soundscape callouts from the POI's position, 5 nearest, repeat limits [R2, R3]; landmarks are fixed things [R11] | Ex, Re | S | **P0** |
| 9 | **Doorway cues and door finder** | Automatic within 3 m and ±70 degrees; hold O ("Nearest door") for a finder | Two short wooden clicks, one from each jamb (`a` then `b`, 60 ms apart), so width and position come in one sound; then "Doorway at 1 o'clock, 3 steps, into the corridor" ("wide doorway" if over 1.2 m; "glass door" with a ringing timbre if glass). While O is held: a ping from the door midpoint, rate by distance like the beacon, pitch rising inside 3 m | Door frame glows (`--d-glass` for glass, ink otherwise), width "1.1 m `MP`" | Apple Door Detection: more frequent feedback and rising pitch as you approach; size and open state as attributes [R16]; wall vs door sounds were confused in Canetroller [R12] | Ex, Re (finder is hint in Re) | M | **P0** (cue) / P1 (finder) |
| 10 | **Wall trailing assist (shoreline)** | T toggles; locks to the nearest wall within `WALL_TRAIL_M = 0.6` on that side; Up walks along it | A soft brush sound from the wall side on every step; it stops dead at an opening, followed by jamb clicks and "Opening on your left"; at a corner a double tap and "Corner, the wall turns right"; T again: "Trailing off" | The trailed wall face is outlined blue, a small hand dot rides along it; openings marked as gaps | Trailing for a parallel line of travel [R10]; perimeter first is how rooms are learned [R9, R8b]; Canetroller shorelining [R12] | Ex, Re | M | P1 |
| 11 | **Sighted guide "follow me"** | G toggles; Up takes the next step together (hold Up to keep walking at 0.7 s per step); Esc or G ends | The guide's footsteps (a distinct heel click) half a step ahead on your guiding side; plain guide phrases at the right moments from the route: "Doorway on your right, going through", "Narrow, step in behind me" (clearance under 1.2 m: guide moves dead ahead), "Step down" (outdoors, from data only), "We're at the reception desk, it's in front of you". On leaving: "I'm leaving you at the desk, facing it." | A graphite capsule guide avatar half a step ahead of the yellow traveller, a short line joining them, path ahead dashed | The standard human guide technique [R25]; route walked with someone first gave the best route learning [R14]; Guerreiro walk mode with step sounds [R21] | Re (first pass), Ex | M | P1 |
| 12 | **Curb to door arrival beat** | First stretch of Rehearse starts at the Vexcel drop off pin; G guide by default here | Car door thunk, street bed (low traffic hush from the street side), guide footsteps on pavement, "The entrance is on the north side, about 20 steps ahead" (from `arrival.entrance_side`, `HAND` pin), then the entrance door's jamb clicks and the lobby echo opening up | The Vexcel ortho as a ground plane, yellow drop off pin `HAND`, ink entrance pin, path from car to door | Aira "last 50 feet" describes layout, angle, and door [R20]; Soundscape My Location for stepping off a bus [R6] | Re | M | P1 |
| 13 | **Point check tie in** | P (phone: "Point" button): "Point to the door you came in." Turn, then Space. Also auto after each beacon arrival in Explore | Ratchet tick every 15 degrees while turning (exists in PointTask); no feedback until Space; then "You were 14 degrees off. The entrance is at 7 o'clock." and the entrance clip from its position | Pointing arrow, true bearing line, error arc and number on the floor | Pointing tests survey knowledge, not memorised strings (agent 3, 3.4); Canetroller used pointing as the test [R12] | Ex, Re | S | P1 (P0 if PointTask is already done) |
| 14 | **Drop off challenge** | In Check yourself: "Drop off" places you at a known fixed landmark, facing a random way, beacon off: "Find your way to the entrance." | Only cane, footsteps, echo, callouts; W allowed; success chime at the entrance; time and bumps spoken | Traveller appears at the landmark; trail drawn; shortest path revealed in grey after the attempt | AbES drop off task, where exploration beat instruction [R1]; the O&M drop off lesson [R10] | Check | M | P1 |
| 15 | **Leap to next landmark** | ] next, [ previous landmark along the route | A 300 ms whoosh (filtered noise sweep), then a short Where am I | The camera glides along the path to the next landmark | Guerreiro VirtualLeap for quick overviews [R21] | Ex | S | P1 |
| 16 | **Home base and squaring off** | Home key ("Back to start" button) | "Back at the entrance. The door is behind you, you're facing in." followed by the door's clip from behind | Traveller returns to the entrance pin with a short glide | Base point by the door [R9]; squaring off [R10]; Guerreiro triple tap to start [R21] | Ex, Re | S | P1 |
| 17 | **Look around by turning** | L toggles look mode; in it Left and Right turn smoothly while held; phone: turn your body | Each item that crosses 12 o'clock speaks its name from its position (a soft tick first); a quiet tick every 30 degrees so turning is audible | A thin 12 o'clock ray from the traveller; items flash as they cross it | BlindSquare Look Around [R15]; Seeing AI names move as you turn [R5] | Ex | S | P1 |
| 18 | **Keys help** | K ("Help" button) | "Arrows walk and turn. Q: around me. E: ahead. Tab: choose a place. Enter: go there. Escape: stop. W: where am I. Space: repeat. K: these keys again." | Keys panel flashes the list once | Hearify H help line [H] (our H is heading) | Ex, Re | S | **P0** (one line) |
| 19 | **Low vision 3D view** | V cycles: normal, high contrast (dark floor, white walls, thick yellow outline on the traveller, landmark labels at 2x), off | Nothing new | The 3D view itself changes; this is for the low vision half of the audience | Low vision visitors use residual vision on arrival [R9]; UI rule "nothing only visual" works both ways | Ex, Re | M | Later |
| 20 | **On site companion** (beacon in the real building, real door detection, curb guidance) | Phone in the real building | n/a | n/a | Needs camera positioning (GoodMaps CPS [R18]), NaviLens codes [R17], or a human (Aira [R20]); Apple itself warns against door detection for navigation [R16] | **LIVE** | L | Later, say so |

Cut from tonight, said in the pitch: explore by dragging a finger on the plan (screen readers capture touch; agent 3, 2.1), elevation cues (generic HRTF elevation is poor; agent 3, 1.6), seat descriptions ("has arms") which our data does not have.

### 3.2 Which interactions run in which mode

| | Explore | Rehearse | Check yourself |
|---|---|---|---|
| Cane taps, footsteps, echo, bump, room entry, doorway clicks, callouts | on | on | on in drop off |
| Q sweep, E ahead, O door finder | on | allowed, logged as hint | off |
| Tab picker | on | on (announce only) | off |
| Enter beacon | on | becomes B (three chirps, hint) | off |
| W where am I, Space repeat, H heading | on | on | on (W only in drop off) |
| T trailing, G guide | on | on; G is the default for the curb beat | off |
| P point | on | after arrival | on |

### 3.3 The journey, beat by beat (what the founder asked for)

| Beat | Data | Interactions | Honest label |
|---|---|---|---|
| 1. Out of the car | `arrival.dropoff`, `entrance_side`, Vexcel ortho | Curb to door (12) with guide (11); W says "Drop off point, entrance to the north, about 20 steps" | `VX`, `HAND` for the pins; outdoor obstacles not mapped, said once |
| 2. Outside to the door | `entrances[0]`, door jambs | Beacon on the entrance in Explore (4), doorway clicks (9) | `VX`, `MP` |
| 3. Through the door | `rooms`, `doors` | Room entry and echo change (7), Home base set here (16) | `MP`, echo `CALC` |
| 4. Lobby to suite | `routes[0].segments`, landmarks | Callouts (8), trailing (10), Around me (1), Ahead (2), Where am I (6) | `MP`, `AI` with confidence |
| 5. Recognise everything inside | landmarks with `fixed` | Around me, Tab picker (3), bump names (5) | "may move" for movable things |
| 6. Prove the map | entrance and desk bearings | Point check (13), drop off (14) | `CALC` |

---

## 4. Audio design for the P0 items (Web Audio, implementable as written)

### 4.1 Name clips (do this first, 10 minutes)

Speech synthesis is outside the Web Audio graph and cannot be panned (agent 3, 1.3), so names that come from places must be audio files.

```sh
#!/bin/sh
# scripts/make-voices.sh web/public/buildings/<sid>/package.json   (macOS: say + afconvert; needs jq)
set -e
OUT=web/public/voices; mkdir -p "$OUT"
{ jq -r '.landmarks[].label, .rooms[].label' "$1"
  printf '%s\n' wall glass doorway "wide doorway" "glass door" door doors entrance exit \
    counter obstacle chair chairs seating stairs elevator restroom "may move" possibly; } |
sort -u | while IFS= read -r w; do
  [ -z "$w" ] && continue
  id=$(printf '%s' "$w" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
  [ -f "$OUT/$id.wav" ] && continue
  say -v Samantha -r 185 -o "/tmp/sv-$id.aiff" "$w"
  afconvert -f WAVE -d LEI16@24000 -c 1 "/tmp/sv-$id.aiff" "$OUT/$id.wav"
done
```

- `clipId(words)` in the web app must use the same rule: lower case, runs of non alphanumerics to one dash, trim dashes.
- Load all clips at Start inside the gesture handler's promise chain (Hearify `SpatialAudio.create`). Missing clip fallback: play a 2 note marimba "name ping" (523 then 784 Hz, 60 ms each) from the position and speak the name in the head at the same moment. Never block exploring on a missing clip.
- Plurals: build "chairs" from the kind table, not by adding "s" to a label.

### 4.2 Graph, buses and levels

```
sources ─┬─ voiceBus  (name clips)            0 dB   ducked −6 dB while the narrator speaks
         ├─ cueBus    (beacon, sweep chirp,   −6 dB  ducked −10 dB while the narrator speaks
         │             door ping, ticks)
         ├─ safetyBus (cane taps, thud,       0 dB   never ducked below −4 dB (agent 3)
         │             jamb clicks)
         ├─ ambientBus (sounding landmarks,   −18 dB
         │             street bed)
         └─ footsteps                          −8 dB  (in the head, ±0.2 alternating pan)
each spatial source also → reverbSend (−10 dB, Hearify) → convolver A/B (crossfaded) → master
buses → master → channel swap / mono (exists) → DynamicsCompressor limiter → destination
limiter: threshold −6 dB, knee 0, ratio 12, attack 0.003 s, release 0.25 s
```

Ducking: on utterance `start`, `bus.gain.setTargetAtTime(dbToGain(duck), ctx.currentTime, 0.02)`; on `end` or `error`, back to the bus level with the same time constant.

Panner factory, shared by every spatial sound (agent 3 `toAudio`, ear plane, no elevation):

```ts
// web/src/audio/spatial.ts
import { toAudio, azimuth } from "./space";
export const ROLLOFF = 0.6;                    // Hearify starting value
export function spatialChain(ctx: AudioContext, at: Vec2, listener: Vec2, heading: number,
                             opts: { rolloff?: number; ref?: number } = {}): { input: AudioNode; output: AudioNode } {
  const [x, y, z] = toAudio(at);
  const panner = new PannerNode(ctx, {
    panningModel: "HRTF", distanceModel: "inverse",
    refDistance: opts.ref ?? 1, rolloffFactor: opts.rolloff ?? ROLLOFF, maxDistance: 40,
    positionX: x, positionY: y, positionZ: z,
  });
  const az = Math.abs(azimuth(listener, heading, at));
  const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: az > 100 ? 3500 : 18000, Q: 0.7 });
  panner.connect(lp);                          // behind cue exaggerated (agent 3, 1.6)
  return { input: panner, output: lp };
}
```

Panners are created per play and disconnected `onended` (Hearify). At most 2 HRTF panners sound at once: the sweep and the beacon are sequential, and the beacon pauses during a sweep.

### 4.3 Sound recipes (render once at Start into mono AudioBuffers)

Use Hearify's `make(seconds, rate, peak, sample)` helper with 2 ms raised cosine edges and peak normalisation. Add ±3 percent `playbackRate` and ±1.5 dB random variation per play for anything that repeats (agent 3).

| Name | Recipe | Length | Peak |
|---|---|---|---|
| `pulse` | sine 880 Hz, 5 ms linear attack, `exp(-t/0.030)` | 120 ms | 0.5 |
| `pulseOn` (facing within 15 degrees) | `pulse` plus sine 1760 Hz at 0.5 amplitude, same envelope | 120 ms | 0.55 |
| `pulseBehind` (over 125 degrees) | sine 660 Hz, `exp(-t/0.040)`; played through an extra lowpass at 1500 Hz | 140 ms | 0.5 |
| `cornerTicks` | two 20 ms sine 1320 Hz blips, `exp(-t/0.006)`, 70 ms apart | 110 ms | 0.3 |
| `chime` | 660 Hz `exp(-t/0.12)` plus 990 Hz from 150 ms `exp(-(t-0.15)/0.15)` (Hearify) | 600 ms | 0.6 |
| `thud` | sine 70 Hz `exp(-t/0.05)` plus, in the first 6 ms, white noise band passed at 1.2 kHz (one biquad, Q 1) at 0.25 of the body | 250 ms | 0.8 |
| `jamb` | 4 ms white noise burst band passed 3 kHz Q 2, plus sine 600 Hz `exp(-t/0.008)` (a dry wooden "tok") | 30 ms | 0.35 |
| `jambGlass` | sharp click plus partials 2.8, 4.1, 6.3 kHz, `exp(-t/0.08)` (agent 3 glass) | 250 ms | 0.3 |
| `sweepStart` | sine chirp 400 to 1200 Hz (phase accumulated), `sin(π t / T)` envelope | 120 ms | 0.2 |
| `namePing` (clip fallback) | 523 Hz then 784 Hz, 60 ms each, `exp(-t/0.02)` | 120 ms | 0.4 |
| `brush` (P1 trailing) | 2 s pink noise loop; per step a 200 ms gain envelope (20 ms attack, 180 ms decay) through bandpass 2.5 kHz Q 0.8 | loop | 0.15 |
| `whoosh` (P1 leap) | 300 ms white noise; at play, lowpass frequency ramps 400 to 2500 Hz exponentially | 300 ms | 0.3 |

### 4.4 Around me sweep (Q)

```ts
// web/src/modes/sweep.ts  (pure part testable)
export const SWEEP_R_M = 8, SWEEP_MAX = 6, GROUP_M = 1.5, SWEEP_GAP_MS = 250;
export function sweepItems(items: Item[], pos: Vec2, heading: number, world: World): SweepItem[] {
  const visible = items.filter(i => dist(pos, i.at) <= SWEEP_R_M && (sameRoom(world, pos, i.at) || los(world, pos, i.at)));
  const groups = groupByKind(visible, GROUP_M);                 // single link, Hearify scan.ts
  const nearest = groups.sort((a, b) => dist(pos, a.at) - dist(pos, b.at)).slice(0, SWEEP_MAX);
  return nearest.sort((a, b) => bearing(pos, heading, a.at) - bearing(pos, heading, b.at));  // clockwise from 12
}
```

Timing:
1. t = 0: `sweepStart` on cueBus (in the head). Narrator is cancelled (Hearify: a non move action cuts speech).
2. t = 150 ms: first item's name clip through `spatialChain` on voiceBus, positioned at the group's mean point (`rolloff 0.6`, so a 6 m item is about −7 dB, which itself carries distance).
3. Each next clip starts `SWEEP_GAP_MS = 250` after the previous `onended`. Shift+Q: after each clip, narrator says "2 o'clock, 5 steps" (priority 1) and the next clip waits for its `end` event plus 150 ms.
4. End: nothing (silence is the end). Caption shows "Desk · Door · Chairs".
5. Cancel: a new Q restarts; any key except arrows cancels (scan token, Hearify `scanToken`). Walking during the sweep keeps it going; clips keep their room positions and the listener moves.
6. Nothing in range: narrator "Nothing within 8 metres. Try E for ahead."
7. Publish `cue{kind:"sweep_item", id, at, label}` as each clip starts so the wedge moves in sync.

### 4.5 Ahead of me cone (E)

- Items with `|azimuth| ≤ 30` degrees, within 12 m, line of sight; nearest first; at most 5.
- Each: name clip from position, then narrator "N steps" (priority 1), 150 ms gap.
- Then `world.raycast(pos, heading, 12)`: hit code 1 "Wall ahead in N steps"; code 4 "Glass ahead in N steps"; code 2 or 3 "Something in the way in N steps" (label from the nearest landmark within 1 m if any); code 5 "Stairs ahead in N steps" at priority 3; no hit "Open for at least 17 steps".
- Publish `cue{kind:"cone", deg: 60, ids, hit_m}`.

### 4.6 Beacon guidance (Enter, Explore only)

Target point: the next waypoint on the path to the target, not the target itself when walls are in between.

```ts
// web/src/modes/beacon.ts
export const MAX_PULSE_S = 1.2, WAYPOINT_M = 1.0;
export const pulseInterval = (d: number) => Math.min(MAX_PULSE_S, 0.25 + 0.15 * Math.max(0, d)); // Hearify
export function beaconPoint(path: Vec2[], pos: Vec2, target: Vec2, world: World): Vec2 {
  // furthest waypoint still in line of sight (skips corners already "seen"), else the next one
  for (let i = path.length - 1; i >= 0; i--) if (los(world, pos, path[i])) return path[i];
  return path[0] ?? target;
}
export function pulseKind(azDeg: number): "pulseOn" | "pulse" | "pulseBehind" {
  const a = Math.abs(azDeg);
  return a <= 15 ? "pulseOn" : a <= 125 ? "pulse" : "pulseBehind";  // Soundscape bands [R4]
}
```

- Path: if the target is the route's `to`, use `route.path`; else if `los(pos, target)` use `[target]`; else A* on the grid downsampled to 0.2 m (P1; tonight fall back to straight line and say "Beacon is straight line, walls may be in the way").
- Scheduling on the audio clock, not animation frames (steady rhythm under load):

```ts
let next = ctx.currentTime + 0.05;
const timer = setInterval(() => {                  // 25 ms lookahead scheduler
  while (next < ctx.currentTime + 0.1) {
    const d = distToTarget(traveller.pos);          // floor distance to the target (door: to its segment)
    const bp = beaconPoint(path, traveller.pos, target, world);
    playAt(next, pulseKind(azimuth(traveller.pos, traveller.heading, bp)), bp, { rolloff: 0.3, ref: 2 });
    publish({ t: "cue", kind: "pulse", at: bp, ts: performance.now() });
    next += pulseInterval(d);
  }
}, 25);
```

- Distance falloff is deliberately weak (`refDistance 2`, `rolloff 0.3`: −11 dB at 20 m). Rate carries distance (Hearify, tempo [R22]); Soundscape does not get louder at all [R3].
- Waypoint passed (within `WAYPOINT_M` of a path corner): `cornerTicks` from that corner, path index advances.
- Arrival `d ≤ ARRIVE_M = 1.5`: stop the scheduler, `chime` in the head, narrator "You're at the reception desk, at 12 o'clock, within reach." Then in Explore: priority 0 offer "Press P to point back to where you started."
- While the narrator speaks, cueBus is ducked 10 dB but the pulse keeps its rhythm.
- Esc: stop, "Beacon off." Tab while going switches target (Hearify).
- Rehearse: Enter maps to B: three `pulse` sounds 300 ms apart from the destination, log `hint`.

### 4.7 Collision thud plus name

- Trigger: `Traveller.step` returns `"bump"`. Contact point = the first blocking cell centre along the step ray (`raycast(pos, heading, STEP_M + 0.3)`).
- Name: code 1 wall ("wall"); 4 ("glass"); 5 ("stairs", priority 3 speech too); 2 or 3: nearest landmark within 1 m of contact, its label clip (movable: append the "may move" clip); with no landmark nearby say "obstacle" (we do not know what an unlabelled point cloud obstacle is, so never guess "chair" or "counter"); within 0.5 m of a `Door` segment: "door" (Hearify `DOOR_REACH_M`).
- Sequence: `thud` on safetyBus through `spatialChain(contact)`, the name clip starts on the thud's `onended` (about 250 ms later) from the same point. Android: `pulse(150)`.
- Same blocker id within 2 s: thud only, no name.
- Publish `cue{kind:"bump", at, label}`.

### 4.8 Where am I (W)

Template (two utterances, each under 160 characters, priority 2):

1. `"{room.label}, about {L} by {W} metres."` from the room polygon's minimum area rectangle (rotating calipers on the convex hull; round to whole metres). No room: `"Between rooms."`
2. Facing: the item with the smallest `|azimuth| ≤ 20` within 10 m: `"Facing the {label}, {N} steps."`; else the raycast hit: `"Facing a wall, {N} steps."` or `"Facing open space."` Then the nearest door: `"Nearest door at {clock} o'clock, {N} steps, to the {other room label}."` In Rehearse add `"Stretch {i} of {n}: {steps} steps, wall on your {side}."`

After line 2 ends, play the nearest door's clip ("door") from the door midpoint so the sentence is anchored in space. Publish `cue{kind:"where", ids}`.

### 4.9 Room entry and the room echo

- `T60 = min(2.0, 0.3 + 0.08 * sqrt(area_m2))` (Task 8), or Hearify's Eyring per band if `echo.ts` is ported. Impulse as agent 3, 1.7 (decorrelated stereo noise, `exp(-6.91 t / T60)`, 15 ms predelay, darkening low pass). Cache by T60 to 0.1 s.
- Wet gain `0.15 + 0.25 * clamp((T60 - 0.3) / 1.4, 0, 1)`.
- Two convolvers; on room change ramp the old wet to 0 and the new to its level with `linearRampToValueAtTime` over 0.3 s. Null room (in a doorway): keep the old.
- Threshold sound: when the traveller crosses a `Door` segment (sign change of the cross product), play `jamb` from `a` then from `b` 60 ms later (glass doors: `jambGlass`). Then speech priority 2: `"{label}, about {L} by {W} metres."` plus, if a fixed landmark is in the room, `"{landmark} at {clock} o'clock."`
- Hysteresis: if `roomAt` changes without a door crossing (open plan), require the new room for 2 consecutive steps.

### 4.10 Landmark callouts on approach

- Each step: for fixed landmarks with `d ≤ 2.5` m and line of sight and not yet called on this approach, call the nearest one. Re arm when `d > 4` m. Global gap 4 s between callouts; Soundscape style repeat limit of 60 s per landmark [R2].
- Sound: the name clip from the landmark on voiceBus. Low confidence: the "possibly" clip in the head first. If the speech queue is busy at priority 2 or more, drop the callout (priority 1).
- Route passing lines from `segment.landmarks_passed`: when the along track projection of the landmark passes the traveller, priority 1: `"Passing the {label} on your {left|right}"` (side from the sign of azimuth).
- Sounding kinds (desk, elevator, water) are ambient loops or intermittent events on ambientBus within 6 m, max 2 (agent 3 budget). They are real sounds of the place; nothing invented.

### 4.11 Doorway cues

- Each step: doors whose midpoint is within 3 m and `|azimuth| ≤ 70`, once per approach (re arm beyond 5 m): `jamb` from `a`, 60 ms, `jamb` from `b`; then priority 1 `"Doorway at {clock} o'clock, {N} steps, into the {room}."` (`"Wide doorway"` if `|a - b| > 1.2` m).
- Door finder (hold O, P1): like the beacon on the nearest door midpoint, but `pulse` pitch rises from 880 to 1320 Hz as `d` goes from 3 m to 0 (Apple: frequency up and pitch up as you approach [R16]); release stops it. Rehearse: logged as hint.
- Never say push or pull, or hinge side: we do not have it. If a future data source does, add it (human guide technique says which way it opens [R25]).

### 4.12 Tests to write first (vitest, each under 20 lines)

- `sweep clockwise from ahead`: items at bearings 270, 10, 90 give order 10, 90, 270.
- `sweep keeps 6 nearest`: 9 items in range return the 6 nearest, then clockwise.
- `sweep skips items behind walls`: fixture item across a wall in another room is excluded.
- `ahead cone ±30`: items at azimuth 29 and 31 give only the first.
- `pulse interval`: 0 m gives 0.25, 5 m gives 1.0, 20 m gives 1.2.
- `pulse kind bands`: 10 gives pulseOn, 60 gives pulse, 150 gives pulseBehind.
- `beacon aims at visible waypoint`: L shaped corridor path returns the corner, not the target.
- `bump names glass`: stepping into a code 4 cell yields label "glass".
- `bump name not repeated within 2 s`.
- `where am I room size`: an 8 by 6 rotated rectangle polygon reads "about 8 by 6 metres".
- `door crossing fires once`: walking through a door segment yields exactly one `jamb` pair and one room line.
- `callout once per approach`: approach, leave beyond 4 m, approach again gives two callouts; standing still gives one.
- `low confidence says possibly`: confidence 0.5 prefixes the possibly clip.
- `beacon is hint in rehearse`: Enter in Rehearse logs `hint` and never starts the scheduler.

---

## 5. What the 3D view needs from the audio side

One message type added to the observer protocol (agent 3, 4.2), published at the moment each sound starts so visuals stay in sync with what the judge hears:

```ts
| { v: 1; t: "cue"; ts: number;
    kind: "sweep_item" | "cone" | "pick" | "pulse" | "waypoint" | "arrive" | "bump"
        | "where" | "room" | "door" | "callout" | "trail" | "guide" | "point";
    at?: Vec2; id?: string; ids?: string[]; label?: string; deg?: number; hit_m?: number }
```

Visual grammar for the 3D view (Apple minimal, existing tokens):
- Yellow `--d-traveller` is only ever the traveller (UI rule "yellow means a person").
- Blue `--d-route` for what the system is pointing at: sweep wedge, cone, picked target, beacon path, trailed wall.
- Orange `--d-obstacle` only for bumps and obstacles.
- Teal `--d-glass` for glass doors and walls.
- Rings and wedges animate at most twice per second and never flash full screen (WCAG three flashes; agent 3, 4.1). Respect `prefers-reduced-motion`: replace motion with an outline change.
- The instruction strip shows the last spoken line; the objects list scrolls to and highlights the id in each `cue`.
- Every number shown carries its chip: steps and echo `CALC`, sizes and doors `MP`, pins `VX`/`HAND`, labels `AI` with confidence.

---

## 6. Keymap after this review (no collisions with the existing stage)

| Key | Action | Status |
|---|---|---|
| Up / Down | step / step back | exists |
| Left / Right | turn 15 degrees | exists |
| A / D, mouse x | sweep cane | exists |
| Space | repeat last line | exists |
| W | where am I | exists, extend (4.8) |
| H | heading | exists |
| B | destination hint | exists |
| M, + / − | mono, speech rate | exists |
| S | **conflict**: agent 3 uses it for channel swap, UI_DESIGN for "source of line". Suggest S = source of line, Shift+S = swap channels | fix tonight |
| 1 to 4, R | quiz answers, repeat options (quiz only) | exists |
| Q / Shift+Q | around me / with details | new P0 |
| E | ahead of me | new P0 |
| Tab / Shift+Tab | next / previous place | new P0 |
| Enter | go (Explore) / hint (Rehearse) | new P0 |
| Esc | stop beacon or guide | new P0 |
| K | keys help | new P0 |
| O (hold) | nearest door finder | new P1 |
| T | trailing assist | new P1 |
| G | sighted guide | new P1 |
| P | point check | new P1 |
| L | look by turning | new P1 |
| ] / [ | leap to next / previous landmark | new P1 |
| Home | back to the entrance | new P1 |
| V | low vision view | Later |

Teach the blindfolded judge only arrows, Space, Q and Tab plus Enter (agent 3: four keys found by feel; Q and Tab sit at the left edge, easy to find). Prevent default on Tab and Space only while the stage has focus, and ignore `e.repeat` for every new key (Hearify and agent 3).

Phone: keep the full screen Step button and the Repeat, Where am I, Recentre row; add a second row of three real buttons, "Around me", "Ahead", "Places" (opens a list of place buttons; activating one picks it and, in Explore, starts the beacon; a "Stop" button replaces "Places" while it runs). No swipes (CLAUDE.md rule 7).

---

## 7. Demo choreography that shows these off (80 s, fits agent 3's 60 s route)

1. Start in the lobby by the entrance: room entry line, the lobby echo is audible on footsteps.
2. Judge presses Q: "Reception desk, chairs, door, elevator" come from around them; the room watches the wedge turn.
3. Judge presses Tab until "Reception desk, 1 o'clock, 14 steps", Enter, holds Up: the pulse speeds up and brightens when they face it; a corner tick at the hallway; chime on arrival. In Rehearse, skip the beacon: the cane and callouts carry them.
4. Bump the counter on purpose: thud and "check in counter" from the right place.
5. P: "Point to the entrance." Error in degrees, arrow on screen. This is the proof that a map was learned, not a beacon followed.

---

## 8. Honesty lines for the pitch

- "Every sound you heard is something the building has: walls, doors, the desk, its echo. The beacon is a practice aid at home. On the day, nothing beeps; that's why we test pointing with the beacon off."
- "Door positions and room sizes come from the Matterport scan. We don't know which way a door opens, so we never say."
- "It's for rehearsing before the visit. It doesn't replace a cane, a guide dog or mobility training, and we haven't tested it with blind users yet; that's next, with an O&M instructor."
- "Guiding someone in the real building needs live indoor positioning, the kind GoodMaps and NaviLens build. That's a partner, not tonight."

---

## Sources

- [H] Hearify repository and code, read in full: https://github.com/ryan11yuan/Hearify (files cited in section 1; spec https://github.com/ryan11yuan/Hearify/blob/main/docs/superpowers/specs/2026-10-08-hearify-sound-rehearsal-design.md)
- [R1] Connors, Chrastil, Sánchez, Merabet 2014, "Virtual environments for the transfer of navigation skills in the blind: a comparison of directed instruction vs. video game based learning approaches", Frontiers in Human Neuroscience: https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2014.00223/full
- [R2] Soundscape (Scottish Tech Army), How Soundscape works: https://scottish-tech-army.github.io/Soundscape-Android/users/how-it-works.html
- [R3] AFB AccessWorld 2018, "Microsoft Soundscape Adds a New Dimension to Accessible Wayfinding": https://afb.org/aw/19/8/15067
- [R4] Soundscape beacon styles (angle bands): https://scottish-tech-army.github.io/Soundscape-Android/users/help-beacon-styles.html
- [R5] Second Sense, "Seeing AI's World Channel: Is it Useful?": https://www.second-sense.org/?p=9484
- [R6] Soundscape, My Location: https://scottish-tech-army.github.io/Soundscape-Android/users/help-my-location.html
- [R7] Soundscape, Around Me: https://scottish-tech-army.github.io/Soundscape-Android/users/help-around-me.html ; Microsoft Soundscape features: https://www.microsoft.com/en-us/research/product/soundscape/features/
- [R7b] Soundscape, Ahead of Me: https://scottish-tech-army.github.io/Soundscape-Android/users/help-ahead-of-me.html
- [R8] Lahav and Mioduser 2008, "Haptic-feedback support for cognitive mapping of unknown spaces by people who are blind", IJHCS 66: https://tau.ac.il/education/muse/publications/94.pdf
- [R8b] Lahav, Schloerb, Kumar, Srinivasan 2012, BlindAid usability study: https://pmc.ncbi.nlm.nih.gov/articles/PMC3864668
- [R9] Guide Dogs UK, "Learning the layout of a room (room familiarisation)": https://www.guidedogs.org.uk/services-we-provide/Getting-around-safely/Learning-the-layout-of-a-room
- [R9b] TSBVI, "Using landmarks" (clues temporary, landmarks permanent): https://www.tsbvi.edu/wp-content/uploads/assets/documents/irl/using-landmarks-om.pdf
- [R10] Colorado Department of Education O&M glossary (trailing, squaring off, drop off lesson, two point touch): https://www.cde.state.co.us/sites/default/files/documents/cdesped/download/pdf/om_glossary.pdf
- [R11] PDRIB O&M glossary (landmark, shoreline, sighted guide): https://www.pdrib.com/pages/omglossary.php
- [R12] Zhao et al. CHI 2018, "Enabling People with Visual Impairments to Navigate Virtual Reality with a Haptic and Auditory Cane Simulation" (Canetroller): https://www.microsoft.com/en-us/research/uploads/prod/2018/01/canetroller.pdf
- [R13] Microsoft Research, Soundscape Street Preview: https://www.microsoft.com/en-us/research/?p=698656
- [R14] BPS Research Digest on Ishikawa et al. 2008 (GPS vs map vs direct experience): https://www.bps.org.uk/research-digest/dont-ditch-your-paper-maps-just-yet
- [R15] BlindSquare, Exploring your environment (Look Around): https://docs.blindsquare.com/m/31663/l/437156-exploring-your-environment
- [R16] Apple, Detect doors around you (Magnifier): https://support.apple.com/guide/ipad/detect-doors-around-you-ipada6aa0d75/16.0/ipados
- [R17] NaviLens technology: https://navilens.com/en/technology
- [R18] GoodMaps features and terms (curriculum): https://coda.io/@jennifer-palilonis/goodmaps-curriculum/goodmaps-features-terms-definitions-5
- [R19] Lazarillo, App Store listing: https://apps.apple.com/app/id1139331874
- [R20] Aira, "Navigating with Aira: 5 effective strategies": https://aira.io/navigating-with-aira-5-effective-strategies
- [R21] Guerreiro, Ahmetovic, Kitani, Asakawa, ASSETS 2017, "Virtual Navigation for Blind People: Building Sequential Representations of the Real World": https://publications.ri.cmu.edu/storage/publications/2017/11/p280-guerreiro.pdf
- [R22] Parseihian et al. 2016, "Comparison and evaluation of sonification strategies for guidance tasks", IEEE Trans. Multimedia: https://scispace.com/pdf/comparison-and-evaluation-of-sonification-strategies-for-1dpfi7jxvq.pdf
- [R23] Kolarik et al., "Using acoustic information to perceive room size: effects of blindness, room reverberation time, and stimulus": https://ueaeprints.uea.ac.uk/id/eprint/81361 ; "Factors affecting auditory estimates of virtual room size": https://research-portal.uea.ac.uk/en/publications/factors-affecting-auditory-estimates-of-virtual-room-size-effects/
- [R24] Paths to Literacy, "Location literacy" (clock face directions): https://www.pathstoliteracy.org/location-literacy-art-knowing-defining-and-communicating-where-you-are-where-you-want-go-and/
- [R25] Guide Dogs UK, "How to guide someone with a vision impairment": https://guidedogs.org.uk/-/media/Project/GuideDogs/GuideDogsDotOrg/Files/Services-we-provide/My-Guide/how-to-guide-someone-with-a-vision-impairment.pdf

Not verified tonight: Picinali et al. 2014 (auditory VR of architectural spaces, IJHCS 72) is relevant but its text was blocked; it is not cited for any claim above.
