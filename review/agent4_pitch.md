# SecondVisit: judge red team, story fixes, pitch and demo

HackPrinceton Fall 2026, JRR building. Written Saturday 8pm ET, about 12 hours before submission.
Inputs read: spec (DRESS_REHEARSAL.md), build plan (docs/plan.md), CLAUDE.md, the ChatGPT LangChain note.

Placeholders in square brackets, such as [A]% or [N] s, must be filled with numbers the engine actually printed for the demo package. Never say a number out loud that the code did not produce (CLAUDE.md rule 1 applies to the pitch too).

---

## 0. Three things to decide in the next 30 minutes

1. **deepagents: in or out.** plan.md line 22 says "LangChain deepagents is skipped"; the team now wants the agent layer on deepagents. Both cannot be true. Recommendation: one person (D) gets until **00:30** to have the orchestrator plus two real subagents (coach, layout advisor) running on deepagents with the existing Python tools. If it is not producing a trace by 00:30, drop the LangChain track and keep the plain Claude tool loops. Do not let LangChain eat time from the rehearsal app, which every other track depends on.
2. **Which building carries the "automatic" claim.** If JRR came back `JRR_SOURCE=traced`, the demo building does not show the core claim. Decide now which sponsor city building (Houston or LA) is the "built automatically" proof, and make sure it builds end to end tonight. Section 2, weakness 1.
3. **Peri: real or not entered.** Send the messages in section 6 tonight. If no real conversation happens by Sunday 10:00, do not enter Peri and do not imply a consultation.

---

## 1. Red team: the judges

Format: the objection as the judge would say it, then the best honest answer. Answers are written to be spoken in about 20 seconds. "Prepare" notes say what must exist for the answer to be true.

### 1.1 CoStar judge (30% data use, 30% agent depth, 25% usefulness, 15% demo)

**Q1. "Your demo building isn't in our data. JRR is traced from a fire plan. Where is the CoStar data actually doing work?"**
> "You're right that JRR isn't in the kit, so we traced it in forty minutes, and we label it 'traced map' on screen. That's the slow way we're replacing. Watch the Houston building: a tenant name goes into CoStar, CoStar gives us the building, floor and suite, that finds the Matterport model, and the rehearsal builds itself in [N] seconds. Each layer has a job: CoStar is the name to suite link and the cotenants we use as landmarks, Matterport is the walls and the desk, Vexcel is which side of the building the door is on and where the car should stop."

Prepare: the Houston or LA build running live (or a recorded run of it with real timestamps), a "data layer strip" on screen showing which field came from which API, and the source badge (`costar` vs `directory`) visible.

**Q2. "Using CoStar as a phone book isn't 'data use'. What can you do with CoStar that you can't do without it?"**
> "Two things. First, landmarks: 'past the pharmacy on your left' comes from CoStar's cotenant list, and those are the landmarks a blind visitor can ask anyone about. Second, the venue side: a clinic choosing where to lease can see vacant suites ranked by how hard they are to learn. CoStar owns Matterport now, so every listing with a 3D tour could carry a navigability score, the way listings show a walk score."

Prepare: verify the CoStar Matterport acquisition wording before saying it (it was announced in 2024 and completed in 2025; check the date on CoStar's newsroom). If suite ranking is not built, say "next" instead of implying it works. Even a ranking of two suites in one Houston building, both computed by the engine, is enough.

**Q3. "Your simulated cane traveller is made up. Why should I believe the layout advice?"**
> "The error model is assumed, and we show its parameters on screen: step length varies 8 cm, heading drifts about 6 degrees per segment, people miscount steps by 12%. We use it to compare layouts against each other, not to predict real arrival rates. The check we ran is that it reacts the right way: remove the step count from one instruction and simulated arrival drops by [X] points, and travellers get lost exactly at that segment. The next step is calibrating it against real runs, starting with the blindfolded runs we logged tonight."

Prepare: the "Assumed" chip with the ErrorModel numbers on the venue view, and `test_vague_lowers_arrival` passing (it is the evidence). Never say "predicts".

Also prepare (agent depth): "What does the agent do that a grid search doesn't?" Answer: code ranks candidate desk positions; the agent proposes fixes code would not enumerate (a tactile strip between two named landmarks, a row of seating as a trailable edge), reads the critique numbers, and revises over up to three rounds. All numbers in the report come from code; show `test_report_numbers_from_code`.

### 1.2 Amazon Practical AI judge (agentic, real impact, adaptive, user friendly, creative; prototype, use case, docs, pitch)

**Q1. "Isn't this two products? A blind visitor app and a facilities consulting tool?"**
> "It's one measurement with two uses. We measure how hard a building is to learn: where the walls are to follow, how much open floor you cross, where people get lost. The visitor uses that to learn the building before they go. The venue uses the same numbers to make the building easier. Same engine, same package file, and the venue is who pays for the visitor's rehearsal."

Prepare: say "one measurement, two uses" in the pitch, word for word, so the judge has heard the answer before asking.

**Q2. "Who pays?"**
> "Never the visitor. The buyer is the venue: clinics and hospital systems already pay for patient wayfinding and lose money on late and missed first appointments. The cheapest delivery is a link in the appointment reminder text: 'Rehearse your visit.' The second channel is the scan owner: a 3D tour on a listing that also works as an accessible rehearsal is a feature a platform like CoStar or Matterport can sell to its owners."

Prepare: no invented market numbers. If someone asks for a dollar figure, say you have not sized it yet. If Peri produced a quote about cost or missed visits, use it here.

**Q3. "How is it 'adaptive'? Looks like an if statement."**
> "The tally is deterministic on purpose, so it can't invent a weak spot: a wrong quiz answer counts 2, going off route 1.5, a hesitation 1. The agent reads those tallies, picks what to rehearse, rebuilds the next run so it starts one segment earlier, repeats the weak turn, adds landmark cues and slows the speech, and tells you why in one sentence. If the agent picks something the data doesn't support, code overrides it. You'll see it change its plan because of what you just did."

Prepare: the run 1 vs run 2 diff on screen (start segment, repeated segment, extra cues, speech rate). If time allows, carry the slower speech rate and cue density into the next session, so "adaptive" covers the user and not just one run.

Also prepare: "Does it work on the phone a blind person actually uses?" Honest answer: Android Chrome gets vibration; iPhone Safari gets audio taps only, after a motion permission tap; desktop keyboard always works. Screen reader users: see 1.5 Q2.

### 1.3 Healthcare judge (creativity, utility, social benefit, evident effort)

**Q1. "Why not just a text description? 'Enter, desk is on the right after the elevators.'"**
> "We generate that too: it's the pocket summary, and it's the right thing to carry on the day. But a description has two problems. Someone has to write it for every building and keep it right, and almost nobody does. And reading it doesn't tell you whether you understood it. The Harvard study we build on found that exploring a virtual copy actively let blind participants navigate the real building. We haven't tested rehearsal against a text description ourselves; that's the first study we'd run, and our quiz is how we'd measure it."

Prepare: the pocket summary visible and readable aloud. Do not claim rehearsal beats text; the spec (weakness 10) admits this is untested.

**Q2. "Safety and liability. Someone rehearses, the desk has moved, they walk into a stanchion. Who is responsible?"**
> "SecondVisit is never used while walking. It gives no live directions in the real building, so the cane, the dog and the person's judgment stay in charge. Every rehearsal opens with the map's source and date, things that can move are marked as movable and never used as the main landmark, and anything the scan wasn't sure of is spoken as 'possibly'. The venue side is guidance for a human to review, not a compliance audit."

Prepare: show the scan date or "traced on Nov 14, 2026" line spoken at the start of the rehearsal. Stairs and drops are hazards the planner avoids. Copy never says "navigate"; it says "rehearse".

**Q3. "Is this healthcare, or is it wayfinding with a clinic pasted on?"**
> "Getting to the desk is part of getting care. The American Foundation for the Blind writes about how hard it is to find the right office in large medical buildings, and a first appointment is exactly the unfamiliar building blind travellers describe as too hard to attempt alone the first time. The outcome we care about is a patient arriving on time, at the right desk, without having to ask a stranger or bring someone."

Prepare: if you want a population figure, check the current CDC vision loss figures yourself before quoting one; do not quote from memory.

### 1.4 LangChain judge (best use of deepagents)

**Q1. "Is deepagents doing real work, or is this four prompts in a trench coat?"**
> "Look at the trace. The orchestrator writes a different plan for a visitor request and a venue request. The spatial investigator decides what data exists: it found no scan for JRR and fell back to the traced map, and said so. The coach and the layout advisor run as separate subagents with their own tools: the coach can change the next run but can't touch geometry; the layout advisor runs hundreds of simulations in its own context so the coach's context stays small."

Prepare: show `write_todos` output and `task` calls to subagents in the trace; each subagent has a scoped tool list. Recommendation: three subagents that each make a real decision (spatial investigator, adaptive coach, layout advisor). The journey planner is deterministic code; make it a tool unless it actually branches on something. A subagent that only forwards a function call will be spotted.

**Q2. "Why does this need an agent at all?"**
> "Most of it doesn't, and we kept it that way: geometry, steps, scores and simulation are plain code. The agent earns its place in three spots where the input is messy: turning a business name into a building, floor and suite when fields are missing, and asking one question when there are two desks; choosing what you should practise next from what you got wrong; and proposing physical fixes for a venue, then critiquing the simulated result and revising."

**Q3. "What happens when the model is wrong?"**
> "It can't put a wrong number in your ear. Spoken numbers are checked against the route data and the template wins if they differ. The coach's choice is checked against the error tallies, and an out of range segment is rejected. If the API is down, you still get a full rehearsal with a template coaching line. These are tests, not promises."

Prepare: be ready to open `test_smooth_rejects_drift`, `test_coach_fallback`, `test_report_numbers_from_code`. Turn the model API off for 10 seconds in the demo only if you rehearsed it.

### 1.5 Blind accessibility advocate

**Q1. "Blindfolding sighted judges is a blindness simulation. Those make people think blindness is helplessness. Why is it in your demo?"**
This is the most dangerous question, because the criticism is real: blind advocates, including writers in the National Federation of the Blind, have argued that blindfold simulations mislead sighted people.
> "Agreed, a blindfold doesn't make you blind, and we're not asking anyone to feel what blindness is like. We use it for one narrow test: can someone with no preview of this building build a map from sound alone? Blind travellers are experts with a cane; our judges aren't, so if it works for a novice with a blindfold, that's the floor, not the ceiling. The people whose verdict counts are blind users, and we haven't run that test yet."

Prepare: say the "a blindfold doesn't make you blind" line in the pitch before the advocate has to raise it. Use a sleep mask, keep the judge seated, never walk anyone blindfolded.

**Q2. "Did you test with blind people? Who designed this with you?"**
> "Not yet, and we won't pretend otherwise. Tonight we ran blindfolded teammates who hadn't seen the map, and changed [one thing] because of it. [If Peri happened: We spoke with ___, ___ at ___, who told us ___.] The next step is sessions with blind users and an orientation and mobility instructor, and the app is built so they can drive it with a keyboard or a screen reader."

Prepare: check VoiceOver on Mac or TalkBack on Android for 10 minutes. If the app's own speech and the screen reader talk over each other, add a "screen reader mode" toggle that turns app speech off and relies on the aria-live region. That is a 30 minute fix and an excellent answer.

**Q3. "Won't venues use this as an excuse? 'We have an app' instead of fixing the building or offering staff assistance."**
> "That's why the venue side exists. Its output is physical changes: move the desk, put seating along a wall people can follow, add a tactile strip. It never tells a venue it's compliant. And rehearsal is something you choose; it doesn't replace asking for help at the door."

Also prepare: "Where does my data go?" Run logs feed the coach for that session; no account; nothing about the person leaves the device except the run log sent to the coach. Make sure that is true.

### 1.6 Orientation and mobility instructor

**Q1. "I teach landmarks and the layout. Step counts are fragile: everyone's stride differs, and they change when you're stressed."**
> "Agreed that steps alone are fragile, so every instruction pairs the count with a wall side and a landmark. There's research behind using steps at all: in Kalia and colleagues' study, blind participants followed routes better with distances in steps than in feet. Step length is a setting, and the quiz tests wall side and landmarks as much as counts."

Prepare: if there is time, a one screen step length calibration ("walk 10 steps along a known distance"). Otherwise just show where STEP_M is set.

**Q2. "The furniture moves. Your scan is from last year. What if the scan is stale?"**
> "We teach the parts that don't move: walls, doors, the desk counter, the elevator. The comparison of furnished and defurnished scans marks what is movable, and movable things are never the main landmark. Every rehearsal says how old its map is. When something changes, the venue can fix it in the trace tool in minutes, and a new scan rebuilds the package automatically."

Prepare: the map date line, and the trace tool open in a tab to show an edit if asked.

**Q3. "Does this replace me? Will clients skip training because the app 'taught them'?"**
> "No, and we'd rather you used it. Imagine you prepare a client for a new hospital: you open the route, check the landmarks we picked, change what's wrong, and send it as homework. They arrive at your session already knowing the layout, so your time goes to the hard parts. It never teaches cane skills."

Also prepare: "Constant wall trailing isn't what I teach." Answer: the planner prefers a wall within reach and penalises long open crossings; it does not demand contact, and the weights are visible and adjustable. Ask the instructor what weights they would set. That question is your Peri evidence if the instructor is a real practice.

### 1.7 Lightning round (one line each)

* **Multiple floors?** Not tonight; the route is one floor. Elevators are landmarks; multi floor is next.
* **Glass walls?** Glass scans badly; it is its own cell type with a ringing tap, and traced maps mark it by hand.
* **How long for a new building?** Scan to rehearsal: [N] s on the Houston building. Without a scan: about 40 minutes of tracing.
* **Wheelchair users?** Same engine, different cost function; not built.
* **Privacy of scans?** Public facing areas only, within the sponsor's data terms.
* **Live navigation next?** No. Rehearsal only, by design.

---

## 2. Biggest weaknesses in the story, and the fix tonight

| # | Weakness | Why a judge will notice | Fix tonight | Time |
|---|---|---|---|---|
| 1 | **The demo building may not show the core claim.** "Built automatically from existing scans" is the whole pitch, and JRR is probably traced. | CoStar and Healthcare judges will ask "was this one built from a scan?" | Say it first, in the pitch: "JRR: traced in 40 minutes, because it isn't in the kit. Houston: built from its scan in [N] s." Show both badges side by side. The traced map becomes the "before" of the automation story instead of a hole in it. | 15 min (badge) plus making sure the Houston build runs |
| 2 | **Too many features for 3 minutes.** Cane, echo, spatial landmarks, clock directions, quiz, coach, arrival, layout advisor, three data layers, four agents. | Judges remember three things. | Pitch only three moments: the blindfold judge finds the desk; the coach changes the run; the building learns where people get lost. Everything else goes on Devpost and in Q&A. | 0 min, discipline |
| 3 | **Two products.** | Amazon and Healthcare judges. | One sentence, every time: "One measurement, two uses: visitors learn the building, venues make it easier to learn." Venue gets 45 s, framed as who pays. | 0 min |
| 4 | **No blind users.** | Every judge, and fatal if it looks hidden. | State it before being asked. Log two blindfold runs by people who haven't seen the map (plan Task 16), make one change because of them, and say what changed. Chase one real conversation (section 6). | 1 h, mostly D |
| 5 | **Blindfold demo reads as a blindness simulation.** | The advocate, and any Healthcare judge who knows the debate. | Frame it as "no preview", not "being blind". Seated, sleep mask, never walking blindfolded. Line in the pitch. | 0 min |
| 6 | **Agent theatre risk.** Four subagents that pass text look worse than none. | LangChain and Amazon. | Three subagents that each decide something; the trace highlights the one decision that changed the outcome ("focus: segment 2, because wrong quiz answer"). | Part of the deepagents timebox |
| 7 | **Assumed numbers look like results.** Arrival rates and scores come from an invented error model. | CoStar (data), any technical judge. | Every simulated number on screen carries the word "simulated"; one "Assumed" chip lists the error model. Say "simulated arrival", never "arrival". | 15 min |
| 8 | **No named user or delivery path.** Amazon asks for a clear use case. | Amazon. | Name the user as a segment, not a fake person: "a blind or low vision patient with a first appointment at a building they have never visited." Name the delivery: a link in the appointment reminder. | 0 min, words only |
| 9 | **Unsourced numbers.** Easy to say "millions of buildings" or a prevalence figure from memory. | Healthcare and CoStar. | Only say figures you checked tonight and can cite on Devpost: the 30 person interview study, the Harvard AbES result, the Kalia steps result. Check any Matterport space count or CDC figure on their sites first or leave it out. | 15 min |
| 10 | **Spec vs plan drift** (deepagents, demo order). | Internal; shows up as a muddled demo. | Decide section 0 item 1 now. Demo order is visitor first, venue second (plan change 7). | 5 min |

### The name: is "SecondVisit" good?

Clarity on first hearing: **medium.** Out of context, "second visit" sounds like a follow up appointment, which in a healthcare track is the literal reading. With one line of explanation it becomes the best name you've had: it states the benefit (the real visit feels like a return), not the mechanism, and it is short and memorable. "Dress Rehearsal" was clear about the mechanism, but "dress" pulls toward clothing and it sounds like theatre.

**Recommendation: keep SecondVisit, and never say it without the tagline.** Tagline: **"Make your first visit your second."** Put it under the logo, in the Devpost title line, on the first slide, and as the last words of the pitch.

Two alternatives, only if the team dislikes the follow up reading:
* **BeenHere:** the feeling you want the patient to have walking in ("I've been here"). Clear, warm, but less distinctive as a search term.
* **FirstSteps:** ties to step count directions and to a first visit; more generic.

---

## 3. One project across five tracks without diluting it

**Core story (never changes, every judge hears it):**
> The first visit to a building is the hard one for a blind traveller, because a cane gives no preview. Rehearsing a building by sound works, but nobody made the maps. The buildings are already scanned. SecondVisit turns existing scans into a rehearsal automatically, checks what you learned, and coaches you on what you missed. The same measurement tells the building where people get lost.

**Per track emphasis.** The pitch and demo below are the same for everyone. What changes is which 30 second block you stretch and which one you shrink, depending on who is at the table. If judging is expo style with different judges per track, the person greeting judges asks "which track are you judging?" and the narrator picks the block.

| Judges | Stretch this 30 s | Shrink | The one sentence they should leave with |
|---|---|---|---|
| **Healthcare / Best Overall** | Blindfold run and the moment they point at the desk; the appointment reminder link | Agent trace (show, don't explain) | "A patient can practise the clinic before the appointment, from a scan that already exists." |
| **CoStar** | The scale moment: tenant name → CoStar suite → Matterport model → rehearsal in [N] s; the data layer strip; suites ranked by navigability; cotenant landmarks | Audio details | "Every scanned listing could also be an accessible rehearsal, and a navigability score." |
| **Amazon Practical AI** | The intentional wrong answer and the run 1 vs run 2 diff; who pays; point at the README | Simulation internals | "It's an agent that changes its plan because of what you got wrong, and it's documented and runnable." |
| **LangChain** | The trace: orchestrator todos, subagent calls, the decision that changed the run, the layout loop's rounds | Arrival, Vexcel | "deepagents plans, delegates and adapts; geometry code decides every number." |
| **Peri** (only if real) | "We spoke with [name, role, organisation]. Their problem in their words was ___. We changed ___ because of it." | Everything technical | "A real organisation told us what was wrong and we fixed it." |

Rule: the narrator says one track specific sentence at the start ("For CoStar, watch the data layer strip at the bottom") so the judge knows where to look.

---

## 4. Pitch script (3 minutes, about 430 spoken words)

Roles: **D** narrates (main voice). **B** speaks the engine and venue part. **C** holds the phone and headphones. **A** drives the laptop and projector.

Projector at start: title slide, "SecondVisit. Make your first visit your second." Observer view loaded in the next tab.

---

**[0:00. D, centre. Title slide.]**

D: "Every one of you found the front desk of this building in about two seconds. You walked in, looked up, and you were done.

Now do it with a cane. A cane tells you what's within a metre of you, right now. It tells you nothing about the room.

Blind travellers move confidently through places they already know. The hard one is the first visit. In one study, thirty visually impaired people described unfamiliar buildings as too difficult to attempt the first time. And the unfamiliar building that matters most is often a clinic: a new specialist, a first appointment.

So we asked: what if your first visit could be your second?"

**[0:35. A switches to the observer view: top down plan of JRR, traveller dot at the entrance.]**

D: "This is SecondVisit. Before the appointment, you rehearse the building at home, by sound. You hold your phone like a cane and sweep it. It taps when it touches a wall that is really there. Big rooms echo. The desk has its own sound. And directions come the way cane travellers find them easiest: 'Turn right to three o'clock. Walk fourteen steps, wall on your right.' Then a short quiz checks what stuck, and the next run focuses on what didn't."

**[1:00. Slide: three logos in a row, Matterport, CoStar, Vexcel, each with its job in four words.]**

D: "This idea works. In 2012, Harvard researchers showed that blind people who explored a virtual copy of a real building could then find their way through the real one. It never spread, because somebody had to build every map by hand, or send a crew to scan it.

But the buildings have already been scanned. CoStar knows which tenant is on which floor and suite. Matterport has the 3D interior. Vexcel shows which side the door is on and where the car should stop. SecondVisit turns those into a rehearsal automatically. Nobody has to go there first."

**[1:30. B steps in. Observer view shows the grid and the planned route along the walls.]**

B: "One rule runs through all of it: geometry decides, the AI describes. Our engine slices the scan into a ten centimetre map, plans a route that follows walls instead of crossing open lobbies, and counts the steps. Every number you hear comes from code.

The agents do what code can't: find the building from a business name, notice which turn you got wrong and rebuild your next run around it.

And it's one measurement with two uses. If we can measure how hard a building is to learn, we can tell the building how to be easier. Our layout advisor sends a simulated cane traveller through hundreds of times. Here, moving reception [where] raised simulated arrival from [A] to [B] percent. Simulated, with our assumptions on screen."

**[2:15. D back. Slide: two badges side by side, "JRR: traced, 40 min" and "Houston: from scan, [N] s".]**

D: "Two honest notes. JRR isn't in our scan kit, so we traced it from the evacuation plan in forty minutes. That's the slow path we're replacing; the Houston clinic you'll see built from its scan in [N] seconds.

And we haven't tested with blind users yet. [If true: We spoke with NAME, ROLE at ORG, who told us ONE SENTENCE.] That's next.

A blindfold doesn't make you blind. It makes you someone with no preview of this building, which is exactly the problem. So let's find out if it works on you."

**[2:50. C steps forward with the phone, headphones and a sleep mask; offers the chair.]**

D: "SecondVisit. Make your first visit your second."

**[3:00. Straight into the demo.]**

---

**If the whole slot is only 5 minutes**, cut to this 45 second opener and go straight to the demo:
> "Every one of you found the front desk of this building in two seconds, because you looked. A cane gives no preview, so for a blind traveller the first visit is the hard one, and a first clinic appointment is the one that matters. Rehearsing a building by sound is proven to work; it never spread because someone had to build every map. The buildings are already scanned. SecondVisit turns existing scans from CoStar, Matterport and Vexcel into an audio rehearsal, quizzes you, and coaches what you missed. One measurement, two uses: the building learns where people get lost. Let's try it on you."

---

## 5. Live demo run of show (5 minutes)

### Roles and positions

* **A, driver:** laptop connected to the projector. Owns every click. Has `docs/DEMO.md` printed and a reset key that returns the app to the start state.
* **C, judge buddy:** holds the phone (Android, for vibration) and over ear headphones, fits the sleep mask, stays beside the seated judge the whole run. Only C talks to the blindfolded judge.
* **D, narrator:** talks to the other judges and the audience, points at the projector. Owns the agent trace explanation.
* **B, venue and scale:** narrates the venue view and the CoStar scale moment.

### Projector layout (observer view)

One screen, three areas, readable from 5 m:
1. **Plan, left two thirds:** top down JRR map, walls dark, glass in a distinct colour, judge's dot and heading arrow, the cane ray drawn live, current route segment highlighted, landmarks as icons.
2. **What they hear, bottom strip:** the last spoken sentence in large text, plus a small icon flash on each tap or echo. This is how the room follows an audio demo.
3. **Agent trace, right third:** each step as one line with a timestamp: `orchestrator: plan` → `spatial_investigator: resolve("…")` → `journey: route 4 segments` → `coach: get_errors` → `coach: set_plan(focus=2)`. The decision line is highlighted.

### Timeline

| Time | What happens | Who | On screen | Fallback |
|---|---|---|---|---|
| **0:00 to 0:20** | A types "I have a first appointment at [JRR destination] in the Julis Romo Rabinowitz building." D: "Watch the right side." | A types, D narrates | Trace: plan, resolve (source: `directory`, labelled), "no scan in kit, using traced map", route 4 segments, package ready | Preloaded package; say "this is the saved result of the same call" |
| **0:20 to 0:40** | C seats the judge, mask on, headphones on, phone in hand. Three controls in 15 s: "Tilt to sweep the cane. Tap the bottom half to step. Swipe left or right to turn. Space bar if we switch to the laptop." | C | Observer view, dot at the entrance | Laptop and keyboard if the phone or tunnel fails |
| **0:40 to 2:00** | **Blindfold rehearsal, 80 s.** D narrates for the room in short lines: "That ring was the glass wall." "It just said fourteen steps, wall on your right." C intervenes only if the judge is stuck for 15 s ("try sweeping left"). | Judge, C, D | Dot moving, cane ray, transcript | At 1:55, if not arrived, C says "two more segments, let's stop here", and D says honestly where they were |
| **2:00 to 2:15** | **Reality check.** Mask off. C hands a printed A3 plan with no route drawn: "Point to the desk." If the table is in the lobby: "Point to where the desk is in this room." | Judge, C | Observer view freezes; A marks the point | None needed; a miss is also data, say so |
| **2:15 to 2:45** | **Quiz, two questions.** Q1 the judge answers for real. Q2 (wall side or turn after landmark): if the judge already got one wrong, keep it ("you gave us a real mistake"). If not, C says "for this one, pick 2, the wrong answer, so you can see the coach." | Judge, C | Question text and options large | A answers wrong on the laptop |
| **2:45 to 3:15** | **Coach adapts.** D: "Here's the agent changing its plan because of you." Trace highlights `coach: get_errors → segment 2 tally 2.0 → set_plan(focus=2)` and the line "Let's practise the turn after [landmark] again." Panel shows run 1 vs run 2: start segment 0 → 1, repeat segment 2, extra cues on, speech 1.0 → 0.9. Play 8 s of run 2's opening aloud on the laptop speaker. | D, A | Trace plus plan diff | Template line if the API is down; say "the model is down, this is the fallback, the plan is the same" |
| **3:15 to 4:00** | **Venue before/after.** A switches to the venue view. B: "Same building, from the building's side." Current reception route grey, red heatmap where simulated travellers got lost, then the advisor's rounds (propose, simulate, critique, revise), green proposed desk and route. Before/after table: score, simulated arrival, open metres, turns. Point at the "Assumed" chip. | B, A | Venue view, rounds log | Saved report JSON rendered; say it's from the run at [time] |
| **4:00 to 4:35** | **Scale (the CoStar moment).** B types a Houston clinic tenant name. Trace: CoStar tenant → building, floor, suite → Matterport model → mesh sliced → route → package, with a running timer. Show the Vexcel image with the entrance pin and driver message ("Please drop me at the north entrance, by ___"). If built: two or three vacant suites ranked by navigability. B: "Nobody went there. It was already scanned." | B, A | Data layer strip at the bottom: which field came from which API | Recorded screen capture of the same run with its real timestamps, labelled "recorded" |
| **4:35 to 5:00** | **Close.** D: "The first visit is the hard one. SecondVisit lets you have it at home, from scans that already exist. Free for the visitor; the building pays to learn where people get lost. The real route starts at that door, about a minute's walk, if you want to try it after. SecondVisit: make your first visit your second." | D | Title slide with QR to Devpost | None |

### Demo rules

* Never walk a blindfolded person. Seated only. The real walk is offered after, eyes open or with a teammate as sighted guide if the judge wants to try it with the mask.
* Over ear headphones, and a splitter so a second judge can listen.
* Reset key tested between every rehearsal; A runs the full show twice before 05:00.
* Saved packages and a local build for no Wi Fi; laptop and keyboard for no phone; template coach line for no API (plan Task 16).
* Record the full 5 minute run once, cleanly, before 06:00. That recording is the Devpost video and the backup.

---

## 6. Peri: a real consultation, tonight or Sunday morning

Honesty rule: Peri needs a real organisation consulted during the event. If it doesn't happen, don't enter, and don't describe an unanswered email as a consultation.

### Step 1 (now, 5 min): ask the Peri rep what counts
Walk to the Peri table or message them on the event Discord: "Would the HackPrinceton organisers, as the operators of this venue, count as the organisation? Or JRR building staff?" Their answer decides everything below.

### Who, ranked by chance of a real conversation before Sunday 10:00

| Rank | Who | Why them | Realistic tonight? |
|---|---|---|---|
| 1 | **HackPrinceton organisers as venue operator for JRR** | They run check in, signage and room layout in this building this weekend; that is exactly the venue side problem. | Yes, in person, now |
| 2 | **JRR building or facilities staff, or the security desk on duty** | They answer "where is ___" all day and know where visitors get lost. | Maybe tonight in person; ask organisers who is on duty |
| 3 | **A certified orientation and mobility specialist in private practice** (found via LinkedIn or the team's own network) | A small business whose clients are the visitor side; best possible feedback on steps, trailing and homework use. | Possible Sunday 8 to 10am by phone or video |
| 4 | **National Federation of the Blind of New Jersey** (state affiliate, volunteer run) | Blind members, the most legitimate voice for the visitor side. | Possible reply Sunday morning; email or contact form tonight |
| 5 | **Princeton University's disability services office** | Owns accommodations on the campus that owns JRR. | Unlikely before Monday; email for the record |
| 6 | **NJ Commission for the Blind and Visually Impaired** | State agency that funds O&M training. | Closed until Monday; email for the record |
| 7 | **A local optometrist or low vision clinic in Princeton** | A clinic is the venue the pitch is about. | Mostly closed Sunday; call any that list Sunday hours |

Do not count sponsors (CoStar, Matterport, Vexcel reps) as the Peri organisation. Verify each office's exact name and contact on its own website before writing to it.

### Message A: to organisers or facilities staff (in person or Discord, send now)

> Hi! We're team SecondVisit. We're building a tool that shows a building where visitors get lost, starting with blind and low vision visitors, and we're using JRR as our test building. Could one of you give us 10 minutes tonight? We'd like to know where people actually get lost finding check in or rooms here, and show you what our layout advisor recommends. With your OK we'd quote you on our Devpost.

### Message B: to an O&M specialist, NFB NJ or a disability office (email or contact form, send tonight)

> Subject: 10 minute feedback on an audio rehearsal tool for blind visitors (HackPrinceton)
>
> Hello, we're four students at HackPrinceton building SecondVisit, which lets a blind or low vision person rehearse a building by sound before a first visit, generated from existing 3D scans. We haven't tested with blind users yet and would value 10 minutes of honest criticism by phone or video, tonight or Sunday before 11am ET. A 2 minute demo is at [link]. Two questions: what would make this useless or unsafe, and would you use it to prepare a client or member for a new building? We'll only name you on our project page if you say yes. Thank you, [name], [phone].

### Evidence to record (one file, `docs/PERI.md`, plus screenshots)

1. Organisation name, person's name and role, date and time, channel (in person, call, email).
2. Written consent to be named and quoted (a "yes" in a message is enough; screenshot it).
3. Their problem in their own words: one or two direct quotes.
4. What you showed them, and what they said was wrong.
5. **One change you made because of it**, with the commit link. This is the strongest evidence and the spec's own Phase 8 gate.
6. A photo only with their permission.
7. If you got no reply: list who you contacted and when, internally only. On Devpost say "we contacted ___; no reply before the deadline" at most, and don't enter Peri.

---

## 7. Five polish items with the best return per hour

Ranked by how much a judge's perception of quality rises per hour of work, given the demo above.

1. **Observer view on the projector with the "what they hear" strip (1.5 h, C or A).** An audio demo is invisible to everyone except the person wearing headphones. A large live transcript, a flash on each tap, the cane ray and the highlighted segment turn it into something the whole table watches. Without it, four of five judges see a person sitting still.
2. **A readable agent trace panel with the decision highlighted (1 h, D).** Human labels ("coach chose segment 2: wrong answer on the turn after the stairs"), timestamps, the subagent name, and one highlighted line. This carries LangChain and Amazon, and half of CoStar's agent depth score. Keep the raw LangSmith trace as a link for anyone who asks.
3. **Provenance and honesty badges everywhere (30 min, anyone).** "Traced map, 40 min" vs "From Matterport scan, [N] s", "source: costar / directory", "Map date", "Simulated", the "Assumed" error model chip, "possibly" landmarks. Cheap, and it pre answers the hardest questions; judges read it as maturity.
4. **The venue before/after card (1 h, B).** One big pair of numbers (simulated arrival [A]% → [B]%), the red heatmap and green proposed desk on the same plan, consistent colours across the app. This is the Devpost hero image and the CoStar screenshot.
5. **Reset key, rehearsed run, and the recorded backup video (1 h, A).** One key returns the app to the start state; the full 5 minute show run twice; one clean recording before 06:00. A demo that never stalls looks more finished than any extra feature.

Not on the list on purpose: the BLE cane handle, room assignment, multi floor, new audio effects. Each costs hours and moves one judge at most.

---

## 8. Devpost page

**Title line:** SecondVisit: make your first visit your second
**Elevator line (under 200 characters):** Blind and low vision visitors rehearse a building by sound before a first visit, generated automatically from existing scans. The same measurement shows venues where people get lost.

### Sections

1. **Inspiration.** The cane gives no preview; the first visit is the hard one (cite the 30 person study); rehearsal works (cite AbES); it never spread because maps were built by hand. Clinics as the building that matters most.
2. **What it does.** Two short parts. *For visitors:* name in, rehearsal out; virtual cane, echo, landmark sounds, step and clock directions; quiz; coach; pocket summary; arrival drop off message. *For venues:* layout advisor, simulated travellers, before/after. One sentence: "one measurement, two uses."
   * Image: **observer view screenshot** mid run (dot, cane ray, transcript strip).
3. **How we built it.** Geometry decides, models describe. Scan or trace → 10 cm grid → cane friendly planner → segments and score → instructions validated against numbers → simulation → layout search. Web Audio for the cane and echo, Web Speech for directions.
   * Image: **architecture diagram** (visitor and venue requests → orchestrator → subagents → deterministic engine → BuildingPackage → web app).
4. **What each data layer does.** Table: CoStar (name to building, floor, suite; cotenant landmarks; listings), Matterport (walls, obstacles, landmarks, fixed vs movable), Vexcel (entrance side, drop off point). Mark which ones worked live on which building.
   * Image: **data layer strip** or the Vexcel arrival image with the entrance pin.
5. **The agents.** Orchestrator plus subagents, each with its tools and the one decision it makes; guardrails (number validator, tally check, template fallbacks).
   * Image: **agent trace** screenshot with the coach decision highlighted.
6. **The venue side.** Heatmap, rounds of propose, simulate, critique, revise.
   * Image: **before/after layout** on JRR with the numbers table.
7. **What is measured and what is assumed.** Two column table. Measured: geometry, step counts, route metrics. Assumed: route weights, score weights, the traveller's error model (list the numbers). This section wins trust.
8. **Validation so far.** Blindfold runs by people who hadn't seen the map (arrival, time, quiz score), and the one change made because of them. Peri consultation if real. "Not yet tested with blind users."
9. **Safety and what we do not claim.** Copy the spec's claims and non claims: rehearsal only, not navigation; never replaces a cane, guide dog or O&M training; not a compliance audit; simulation doesn't predict real behaviour.
10. **Challenges.** JRR not in the scan kit and the trace fallback; glass; iOS has no web vibration; keeping model wording tied to the numbers.
11. **Accomplishments.** The blindfolded judge found the desk; the coach changes the run; the Houston building built from its scan in [N] s.
12. **What's next.** Sessions with blind users and an O&M instructor; rehearsal vs text description study; multi floor; instructor mode; navigability on listings.
13. **Track notes.** Five short paragraphs, one per track, each pointing to where in the video and repo the criteria are met (timestamps).
14. **Built with.** Python, numpy, scipy, trimesh, shapely, pydantic, FastAPI, deepagents (if used), Claude, TypeScript, Vite, Web Audio, Web Speech, Matterport, CoStar, Vexcel.
15. **Sources.** The spec's reference list.

Video: the clean 5 minute run from section 5, or a 2 minute cut (opener, rehearsal, coach, venue, scale).

## 9. README outline (Amazon "docs")

1. **SecondVisit.** One paragraph, the tagline, one screenshot, a "not a navigation aid" note.
2. **Who it's for.** Visitor: blind or low vision person before a first visit. Venue: clinic or building operator. O&M instructor as a future user.
3. **Try it in 2 minutes.** Hosted link or `npm run dev` with the saved JRR package; controls table.
4. **Controls.** Keyboard (arrows, A/D, Space, H), phone (tilt, tap, swipe), what works on Android, iOS and desktop, screen reader mode.
5. **Install and run.** Requirements, `.env.example` variables (names only), engine and web commands, tunnel for phones, offline mode (`DR_OFFLINE=1`).
6. **Build a building.** `dr.cli build` from a Matterport mesh, a trace, or the fixture; using the trace tool; what the output package contains.
7. **Architecture.** The diagram, the "geometry decides, models describe" rule, the BuildingPackage contract (link to the schema).
8. **The agents.** For each agent and subagent: what it decides, its tools, its guardrail, its fallback. How to view a trace.
9. **Data sources and provenance.** Which fields come from CoStar, Matterport, Vexcel; how missing data is labelled; data terms and the public spaces only rule.
10. **Measured vs assumed.** Constants (`STEP_M`, `CANE_M`, ...), planner and score weights, error model.
11. **Accessibility.** Keyboard only operation, aria-live mirroring, audio start gate, contrast, tested screen readers.
12. **Safety and limitations.** The known weaknesses from spec section 10, plainly.
13. **Testing.** `pytest -q`, `npm test`, and the five tests that prove the main claims (`test_follows_walls`, `test_smooth_rejects_drift`, `test_focus_on_failed_quiz`, `test_vague_lowers_arrival`, `test_report_numbers_from_code`).
14. **Troubleshooting.** iOS motion permission, no vibration on iPhone, no route found (`--close-gaps`), audio not starting.
15. **Roadmap, team, acknowledgements, licence.**

---

## 10. Pre submission checklist (05:00 freeze)

* [ ] Every placeholder in this file replaced by a number the engine printed, or the sentence cut.
* [ ] "Simulated" next to every simulated number; "traced" or "from scan" on every map.
* [ ] Pitch timed out loud twice at 3:00 or under.
* [ ] Demo run twice end to end with the reset key; backup video recorded.
* [ ] Two logged blindfold runs and one change made because of them.
* [ ] Peri: real conversation documented, or the track not entered.
* [ ] deepagents: trace working, or the LangChain track dropped and the README says plain Claude tool loops.
* [ ] Devpost track notes written with video timestamps.
