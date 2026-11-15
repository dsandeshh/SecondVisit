# SecondVisit review 3: experience, audio and accessibility

Reviewer: agent 3 (experience, audio and accessibility risk). Written Saturday 20:00 ET, about 12 hours before the end.
Inputs read: spec `DRESS_REHEARSAL.md`, `docs/plan.md` (Tasks 8, 9, 10, 16, Review Focus), `CLAUDE.md`.
Browser facts were checked on the web tonight; sources are listed at the end. Where a claim is practitioner knowledge rather than a cited source it says "(field note)", and where a number is an estimate it says so. Measure those on our own devices.

Priority labels: **P0** do tonight, small, protects the judge demo. **P1** do if time after 01:00. **P2** say it in the pitch as future work.

---

## 0. The ten things that most likely break the demo

| # | Risk | Where | Fix | Pri |
|---|---|---|---|---|
| 1 | Bluetooth headphones add enough delay that the cane tap arrives after the sweep, and the cane feels fake | all | Wired closed back headphones only. Show `ctx.baseLatency + ctx.outputLatency` on the operator panel and warn if over 50 ms | P0 |
| 2 | Projector plugged in by HDMI steals the audio output, judge hears nothing | macOS laptop | Checklist line: after connecting the projector, set Sound output to the headphones. Speak "Sound check" on Start so the operator hears it before the mask goes on | P0 |
| 3 | Someone clicks the observer window, keyboard focus leaves the rehearsal window, arrow keys do nothing, the blindfolded judge thinks they are stuck | laptop | On `blur` speak "Paused. Focus lost." and pause the run; on `focus` say "Resumed". Observer runs on a second device or teammates never click it | P0 |
| 4 | Holding Up arrow auto repeats at about 30 Hz: 30 steps a second, speech floods, the judge flies through walls of instructions | laptop | Step rate limit 400 ms; ignore `e.repeat` for Space, H, 1 to 4 | P0 |
| 5 | Judge never sweeps the cane, so hears only speech and no taps; the core sensation is missing | laptop | Auto sweep: every step sweeps the cane through an arc (two point touch). Manual A/D sweep stays for probing | P0 |
| 6 | Speech stops halfway (Chrome long utterance bug) or lags (online Google voice on congested venue Wi Fi) | Chrome desktop | Prefer a `localService` voice, keep every utterance under about 10 s, split at sentences | P0 |
| 7 | iPhone on silent: Web Audio is muted while speech may still play, so it "half works" | iOS Safari | `navigator.audioSession.type = "playback"` before creating the context (iOS 17+); silent looping `<audio>` fallback for older iOS | P0 (one line) |
| 8 | AudioContext "interrupted" after screen lock or switching apps; silence with no error | iOS Safari | `statechange` handler; on interrupted or suspended say "Sound paused. Tap to resume" and resume on the next gesture. Request a screen Wake Lock at Start | P0 |
| 9 | Fast mouse or phone sweep jumps 20 degrees between frames and misses a 1 m pillar | all | Interpolate rays between last and current cane angle in 2 degree steps every frame | P0 |
| 10 | A continuous destination beacon turns the rehearsal into homing: the judge follows the sound, learns no map, and the real building has no beacon | design | No destination beacon in Rehearse. Beacon only on request (key B, logged as a hint). Landmark sounds only for things that make sound in reality | P0 |

---

## 1. Technical pitfalls with concrete fixes

### 1.1 Starting audio, speech and motion from one gesture

All three need a user gesture and the iOS gesture window is short, so start everything synchronously inside the Start click handler before the first `await`.

- Chrome autoplay: an `AudioContext` created before a gesture starts `"suspended"`. Create it inside the click and call `resume()` there.
- iOS Safari: on iOS the default audio session maps to "ambient", so Web Audio is silenced by the ringer switch; WebKit closed the bug as configuration changed and points to `navigator.audioSession.type = "playback"`, available since iOS 17 [S1][S2]. Only Safari implements Audio Session, so feature test it [S2]. For older iOS, the known workaround is a silent looping `HTMLAudioElement` that makes the page count as media playback [S2].
- iOS Safari blocks `speechSynthesis.speak()` that is not triggered by a user interaction; prime it with one utterance inside the gesture and later programmatic calls work [S5]. We prime with a useful line ("Starting.") instead of a silent one.
- `DeviceOrientationEvent.requestPermission()` needs transient activation and a secure context, and resolves `"granted"` or `"denied"`; feature test with `typeof DeviceOrientationEvent.requestPermission === "function"` [S7].
- Android Chrome and desktop Chrome do not ask permission, but desktop has no sensor. Treat motion as available only after a real event with non null `alpha` arrives within 1 s.
- Screen Wake Lock (`navigator.wakeLock.request("screen")`) keeps the phone from locking mid run, which would interrupt the AudioContext. Feature test; failure is fine.

```ts
// web/src/audio/engine.ts  (P0)
export async function start(): Promise<StartReport> {
  const nav = navigator as any;
  if (nav.audioSession) nav.audioSession.type = "playback";            // iOS 17+, before the context
  const ctx = new AudioContext({ latencyHint: "interactive" });
  const resumed = ctx.resume();
  const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  s.connect(ctx.destination); s.start();                                // iOS unlock
  speech.prime("Starting.");                                            // first speak() inside the gesture
  const DOE = (window as any).DeviceOrientationEvent;
  const perm: Promise<"granted" | "denied" | "unavailable"> =
    !DOE || !window.isSecureContext ? Promise.resolve("unavailable")
    : typeof DOE.requestPermission === "function"
      ? DOE.requestPermission().then((r: string) => (r === "granted" ? "granted" : "denied"), () => "denied")
      : Promise.resolve("granted");
  const wake = nav.wakeLock?.request("screen").catch(() => null) ?? Promise.resolve(null);
  const [, p] = await Promise.all([resumed, perm, wake]);               // first await is here
  const motion = p === "granted" ? await firstRealOrientation(1000) : p; // "unavailable" on desktop
  ctx.onstatechange = () => { if (ctx.state !== "running") onAudioPaused(); };
  return { audio: ctx.state === "running" ? "running" : "failed", motion,
           vibrate: "vibrate" in navigator, latencyMs: latencyOf(ctx) };
}
const latencyOf = (c: AudioContext) =>
  Math.round(1000 * ((c.baseLatency ?? 0) + ((c as any).outputLatency ?? 0)));
```

After Start the app speaks one status sentence built from the report, for example "Sound on. Motion not available, use the arrow keys." (Review Focus 1 and 4).

### 1.2 AudioContext after interruptions

`AudioContext.state` can be `running`, `suspended`, `interrupted` or `closed`; `interrupted` is set by the browser for interruptions outside the app, and on iOS Safari leaving the page or turning off the screen sets it and the app must resume [S9]. Handle it in `statechange`: duck nothing, announce "Sound paused. Press Space or tap to resume", call `resume()` on the next key or tap. Also pause the run timer so the coach does not log a hesitation.

### 1.3 speechSynthesis

| Quirk | Fix |
|---|---|
| Voices load asynchronously; `getVoices()` is often empty at first | Do not block on voices. Speak with the default voice; when `voiceschanged` fires, pick once: first `localService && lang.startsWith("en")`, else default |
| Chrome stops mid utterance with Google voices, still reports speaking [S3]; any utterance over about 14 s triggers it on Chrome desktop [S4] | Local voices avoid it [S3]. Split text at sentence ends into chunks of at most 160 characters. Our instructions are one sentence; the Pocket summary must speak one instruction per utterance. If a Google voice is the only one, run the `pause()` then `resume()` every 14 s workaround [S3] (P1) |
| Google voices in Chrome need network [S4] | Venue Wi Fi is congested: another reason to prefer `localService` |
| Safari marks every voice `default`; Android lists voices that are not installed [S4] | Never trust `default`; on Android, keep `voice` unset and set only `lang` |
| iOS needs a gesture for the first speak [S5] | Prime in Start (1.1) |
| Speech can be delayed after other audio on Safari [S5] | Prime once; accept a short delay; never time quiz answers from the end of speech |
| `onend` sometimes never fires if the utterance object is garbage collected (field note) | Keep a reference to every live utterance until `end` or `error` |
| `cancel()` makes the cancelled utterance fire `error` with `"canceled"` or `"interrupted"` | Treat those two as normal, not as failures |
| Chrome can be left in `paused` after the tab was in the background (field note) | Before `speak`, `if (speechSynthesis.paused) speechSynthesis.resume()` |
| Rate | Default 1.0; coach rate 0.9 as planned. Screen reader users often listen far faster than 1.0, so add `+` and `-` to change rate by 0.15 and remember it in `localStorage` (P1) |
| Pile up (Review Focus 2) | Priority instead of plain interrupt: safety 3 (stairs, arrived, off route), instruction 2, landmark 1, info 0. A line interrupts only lines of equal or lower priority; a lower one is dropped. At most one utterance plays |
| Speech is outside the Web Audio graph, so it cannot be mixed with our sounds | Duck our own beacons by 10 dB and taps by 4 dB between `start` and `end`. Never duck taps fully: they are the safety channel |

### 1.4 Orientation: compass versus relative

- Use **relative** yaw for the cane, never the compass. Steel and electronics indoors distort the magnetometer, and the rehearsal heading is the virtual building's, not north.
- iOS: `deviceorientationabsolute` does not work in Safari; the compass is `webkitCompassHeading` after permission. Chrome provides absolute orientation through `deviceorientationabsolute` [S8]. We only need `deviceorientation` (relative) on both.
- At Start, and on a "Recentre" button, store `alpha0`; heading = `entrance.heading_deg + wrap(alpha0 - alpha)` (alpha grows counter clockwise, our heading is clockwise).
- Euler angles become unstable when the phone is held upright and pointed forward (beta near 90 degrees). Tell the user to hold the phone **flat, screen up, top edge forward**, like a TV remote. In that pose alpha is stable (field note).
- Plan says gamma sweeps the cane and swipes turn the body. Swipes do not survive a screen reader (section 2). Amended phone model: **turning your body turns you** (relative alpha sets heading), **rolling the wrist sweeps the cane** (gamma, clamp ±50), **one full screen Step button** walks. Low pass the angles (one pole, alpha 0.2) to kill jitter.
- Screen rotation: iOS Safari cannot lock orientation; ask users to lock rotation and make the layout work both ways.

### 1.5 Vibration

- `navigator.vibrate`: no iOS Safari version supports it; Chrome for Android does; Firefox desktop dropped it from 129 [S6]. Desktop Chrome exposes it but there is no motor.
- Always guard: `if ("vibrate" in navigator) navigator.vibrate(ms)`. An unguarded call throws on iOS.
- Chrome blocks vibrate before the user has interacted with the page (field note); fine after Start.
- Pulses shorter than about 20 ms are not felt on many Android motors (estimate). Use 25 ms contact, 60 ms landmark, 150 ms bump.
- Honest line: "no vibration in iPhone browsers, so on iPhone the cane is sound only". The BLE handle (Optional H) is the real fix, but Web Bluetooth is not on iOS either.

### 1.6 Spatial audio (HRTF PannerNode)

- HRTF panning is the costly mode because it convolves with HRTF pulses, and moving sources add interpolation; a short reverb plus `equalpower` panning is a cheaper mobile alternative that localises nearly as well when the source moves [S10]. Budget: at most 2 HRTF panners active at once (section 3.3). Disconnect panners beyond 6 m, do not just set gain 0 (a connected node still computes). Add `?pan=eq` to force `equalpower` on a slow phone.
- Generic HRTF means front and back confusion and poor elevation for most listeners (field note). Mitigations: put every source at ear height (no elevation); use broadband, transient sounds (clicks, chirps), not sine tones; low pass sources behind the listener (cutoff 3.5 kHz when |azimuth| > 100 degrees) to exaggerate the cue; turning resolves the rest, so update the listener on every turn.
- Coordinate mapping is the classic bug (left and right swapped). Web Audio is right handed with forward = −z. Plan frame: x right, y up (north), heading clockwise from +y.

```ts
// web/src/audio/space.ts  (P0, pure, testable)
export const toAudio = ([x, y]: Vec2): [number, number, number] => [x, 0, -y];
export const forwardFor = (h: number): [number, number, number] =>
  [Math.sin(h * Math.PI / 180), 0, -Math.cos(h * Math.PI / 180)];
/** Signed azimuth of src from listener, degrees, positive = right. */
export function azimuth(listener: Vec2, heading: number, src: Vec2): number {
  const b = Math.atan2(src[0] - listener[0], src[1] - listener[1]) * 180 / Math.PI;
  return wrap180(b - heading);
}
```

  Set the listener with `listener.forwardX.value` and friends when present, else `listener.setOrientation(...)`; Firefox lacks the AudioParam form (field note, feature test).
- Cane taps use `StereoPannerNode` with `pan = sin(caneDeg)` rather than HRTF: cheap, instant, and the contact is always within 1.2 m in front.

### 1.7 Reverb (ConvolverNode)

- Convolution cost grows with impulse length [S10]. Cap the decay at 2.0 s; the plan's formula `0.3 + 0.08 * sqrt(area)` gives about 1.7 s for a 300 m² lobby, fine.
- Generate the impulse procedurally: stereo noise with independent L and R channels (decorrelated, sounds wide), envelope `exp(-6.91 * t / T60)` (60 dB down at T60), 15 ms predelay, and a one pole low pass whose cutoff falls with time (high frequencies die first, which is what makes it sound like a room, not a hiss). About 25 lines, done once per room at load. Cache by T60 rounded to 0.1 s.
- Swapping `convolver.buffer` while sound plays clicks (field note). Use two convolvers and crossfade their wet gains over 300 ms when `roomAt(pos)` changes. In a doorway `roomAt` may be null: keep the previous room.
- Feed footsteps and taps into the reverb send; footsteps are the main room size cue. Wet gain 0.15 (small room) to 0.4 (lobby).

### 1.8 Latency from contact to tap (target under 50 ms)

| Stage | Typical | Fix |
|---|---|---|
| Input event | keydown immediate; `deviceorientation` about 60 Hz, up to 16 ms (estimate) | Raycast inside the input handler, not on the next animation frame |
| Make the sound | 0 ms if buffers exist | Pre render every tap buffer at Start; `start(0)` a new `AudioBufferSourceNode` |
| Browser and OS output | Laptop Chrome measured end to end at about 55 to 67 ms default and 70 to 100 ms on a 2022 MacBook Air [S12] | `latencyHint: "interactive"`; show `baseLatency + outputLatency` (supported Chrome 102, Firefox 70, Safari 18.4 [S11]) |
| Bluetooth | Often reports less latency than it delivers [S12]; commonly 100 to 300 ms (estimate) | Wired only |

Honest expectation: under 50 ms total may not be reachable on a Mac in Chrome. What matters is that latency is short and constant. Measure it tonight in 10 minutes: film the keyboard with a phone (sound on), press Up next to a wall, and read the gap between the key click and the tap in any audio editor. Put the number in `docs/DEMO.md`.

### 1.9 Headphones are mandatory

Spatial audio and the left and right cane pan do not work on laptop speakers, and the venue is loud. At Start (after audio unlocks) run a 5 second check: "Click in your left ear... now your right. If that was backwards, press S." S swaps channels (a `ChannelSplitter` and `ChannelMerger`). Key M toggles mono for single sided hearing (section 5.4). Put a `DynamicsCompressorNode` as a limiter on the master bus so a glass tap can never be painfully loud.

---

## 2. Screen readers

### 2.1 The conflict

Blind users run VoiceOver or TalkBack. Both capture touch: a swipe moves the screen reader focus, a double tap activates the focused element. Custom swipes never reach the page. A web page cannot opt into VoiceOver direct interaction: the native trait `allowsDirectInteraction` has no HTML or ARIA equivalent, and a developer asking for one on AppleVis got no answer [S14][S15]. "Direct Touch" in the VoiceOver rotor is a typing mode for the keyboard, not for page content [S13]. The user can pass one gesture through by double tapping and holding until three rising tones, then making the gesture [S16], but asking that of every step is not a usable design.

Desktop is easier: NVDA and JAWS intercept arrows in browse mode, but a focused element with `role="application"` switches them to focus mode so our keys arrive. macOS VoiceOver uses Control Option for its own commands, so arrows reach the page.

### 2.2 Minimum viable approach for tonight (P0, about 60 min total)

1. **Keyboard first.** The judge demo is desktop Chrome (CLAUDE.md rule 5a). The stage is one focused `<div id="stage" tabindex="0" role="application" aria-label="Rehearsal. Up arrow to walk, left and right to turn, Space to repeat.">`. `preventDefault` for arrows and Space so the page never scrolls.
2. **Phone without gestures.** Replace swipes with real `<button>` elements, which every screen reader can activate with a double tap anywhere once focused: a full screen **Step** button, and below it **Repeat**, **Where am I**, **Recentre**. Turning is physical (relative yaw, section 1.4). The quiz uses four stacked buttons, not four screen quadrants. This works with VoiceOver, TalkBack and with no screen reader.
3. **Who speaks.** The Start screen has two buttons: "Start with app voice" and "Start with my screen reader".
   - App voice (default): our `speechSynthesis` speaks; the visible transcript has `aria-live="off"` so a running screen reader does not speak every line a second time.
   - Screen reader: we never call `speechSynthesis.speak`; every line goes to a live region, `aria-live="polite"` for instructions and info, `aria-live="assertive"` only for safety lines (stairs, arrived, off route). Sounds still play.
   - This amends CLAUDE.md rule 6 ("every spoken string is also written to an aria-live polite region"): it still is written, but live only in screen reader mode, because double speech is worse than either alone. Record in `docs/CHANGELOG.md`.
4. **Live region hygiene.** One persistent region present from page load (regions inserted later are often ignored, field note); replace its text, do not append; when the same line repeats, clear it, then set it on the next frame so it is announced again.
5. **No hidden essentials.** Every sound that carries meaning has a spoken equivalent on request: Where am I (W) says the room and the nearest landmark as a clock direction; H says heading.

### 2.3 What to say in the pitch, honestly

- "Real blind users run screen readers, and screen readers take over touch gestures. So our phone version has no custom gestures: one big Step button and your own body turning. On a laptop it works with a desktop screen reader through the keyboard. We tested tonight with VoiceOver on [device] / we did not get to test with TalkBack." Say only what was actually tested.
- "Tonight's testers were sighted people under a blindfold. They are not a proxy for blind travellers, who have cane skills and years of listening experience. Validation with blind users and a mobility instructor is our next step." (Spec Phase 8.)
- Do not frame the judge run as "experience what it is like to be blind". Blindfold simulations tend to highlight the shock of becoming blind rather than the reality of being blind, and in one study 52 percent of blindfolded students rated blind people as less able to live independently, against 32 percent of controls [S17]. Frame it as "try the tool the way its user would".

---

## 3. Design for sensory honesty

### 3.1 Make the cane feel real

- **Contact is edge triggered.** A tap plays when contact begins, when the material code changes, or when the contact point jumps more than 0.3 m (a new surface). Minimum 60 ms between taps. Holding the cane against a wall is one tap, not a buzz.
- **Auto sweep (two point touch).** Each step sweeps the cane through an arc from −30 to +30 degrees (alternating direction each step) over 350 ms, using the interpolated ray sweep. Real cane users arc about shoulder width at each step; ±30 degrees at 1.2 m is a little wider, which is kinder to beginners. Manual A/D and phone gamma sweep override it while held.
- **The cane stops.** When a sweep hits something, the effective cane angle stays at the contact until the input moves back to the free side (P1). That is how a pillar "feels" in the hand.
- **Floor tick.** At each end of a sweep with no contact, play a very quiet soft tick (−24 dB). Real canes tap the floor. This is how the user tells "nothing there" from "app is broken".
- **Timbre per material** (pre rendered buffers, ±3 percent pitch and ±1.5 dB random variation per tap so it never sounds like a machine gun):

| Code | Surface | Sound recipe (about 10 to 250 ms) |
|---|---|---|
| 1 wall | plaster or drywall | 6 ms noise burst, band pass 2.2 kHz Q 1.2, plus a 30 ms 180 Hz thump at −12 dB. Dry "tock" |
| 2 fixed obstacle | counter, pillar | band pass 900 Hz Q 4, 40 ms decay. Duller "knock" |
| 3 movable | chair, bin | metallic: partials 1.7, 3.9, 6.1 kHz, 120 ms decay. "Tink" |
| 4 glass | glass wall, door | sharp click plus partials 2.8, 4.1, 6.3 kHz, 250 ms ring |
| 5 stairs or drop | edge | no floor tick where it should be, a short downward pitch slide, and speech priority 3 "Stairs ahead" (once per approach) |
| bump | traveller hits | 60 ms low thump 90 Hz, louder than taps, 150 ms vibrate |
| footstep | each step | 40 ms low passed noise, alternating ±0.2 pan, into the reverb |

- **Distance falloff** within the cane: gain `1 − 0.4 * dist / CANE_M` (0 to −4.4 dB). Distance inside a cane is felt through angle and timing more than loudness, so keep it mild.

### 3.2 Convey open space with silence plus reverb

Open space is the hardest and most dangerous part of a cane route (spec principle 6). Render it honestly: floor ticks only, no taps, a longer and wetter reverb, footsteps that ring. When entering a segment with `open_m > 3`, speak once (priority 2, numbers from the package): "Open area for about {round(open_m / STEP_M)} steps, nothing to follow." That number must come from the package (CLAUDE.md rule 1).

### 3.3 Do not overwhelm: a sound budget

| Channel | Max at once | Rule |
|---|---|---|
| Speech | 1 | Priority queue (1.3) |
| Landmark sources | 2 | Only kinds that sound in real life: desk (soft typing and murmur), elevator (ding every 6 s), water (fountain hum), automatic door (motor whirr when within 3 m). Pillars, seating, signs are silent until touched. Nearest two within 6 m |
| Cane taps and floor ticks | transient, 60 ms gate | Never ducked below −4 dB |
| Footsteps | 1 per step | |
| Reverb | 1 (2 during a crossfade) | |

Landmark sounds are intermittent (a 200 ms event every 1.5 to 6 s), not loops: onsets localise better and fatigue less.

**Sensory honesty rule:** only render a sound the real place makes, so the rehearsal trains cues that will exist on the real visit. If a landmark sound is invented (none should be), the Pocket summary says so. No destination beacon in Rehearse; key B plays three chirps from the destination and logs a `hint` (counted by the coach like a hesitation).

### 3.4 What the quiz should test: a mental map, not memorised strings

The planned four questions (steps on a segment, wall side, turn after a landmark, destination clock hour) test route knowledge: a memorised sequence. A mental map is shown by survey knowledge, which a pointing task tests directly.

**Pointing task (the measurable demo moment).** After the run, the user is placed back at the entrance, facing into the building, and told so. "Turn to face the reception desk, then press Space."
- Laptop: Left and Right turn 5 degrees per press (hold for 60 degrees per second), with a soft ratchet tick every 15 degrees so turning is audible. Phone: turn your body, press Confirm.
- No feedback until confirmed. Then: "You were 14 degrees off. The desk is at 1 o'clock from here."
- Error = `|wrap180(bearing(entrance, desk) − heading)|`, straight line bearing, not the route. Random pointing averages 90 degrees error, so anything under 30 degrees is clearly learning. Show it on the observer view as an arrow, the true bearing, and the error arc.
- Run it after run 1 and after run 2. Run 1 error versus run 2 error is the before and after number for the Amazon "adapts" story, and it is not inflated by having heard the quiz before.

**Route reversal question (P1).** "Walking back from the desk to the entrance, on the first stretch, is the wall on your left or your right?" Answering needs a mental transformation, not recall.

Keep 3 of the planned multiple choice questions, add pointing, and the reversal question if time. Total under 90 s.

---

## 4. Observer view for sighted judges

### 4.1 What it shows

A second page `observer.html` on the projector:
- the plan from the same `package.json` (grid shaded by code, room labels, landmarks);
- the route, with the current segment highlighted;
- the traveller dot with a heading wedge and the live cane ray (grey, coloured by material on contact);
- tap flashes as small rings at the contact point that fade over 300 ms, coloured by material. Small rings only: no full screen flashes, to stay clear of the WCAG three flashes per second rule;
- a large caption bar with the last spoken line;
- quiz answers ticked or crossed, the pointing arrow with its error arc and number;
- the coach line between runs, with the focus segment outlined;
- run 1 trail dashed grey, run 2 trail solid; a before and after table: time, bumps, off route events, quiz score, pointing error.

The observer is one way. It cannot send anything to the rehearsal device, so it can never disturb the blindfolded user.

### 4.2 Minimal message protocol (v1)

```ts
// web/src/observer/protocol.ts
export type ObsMsg =
  | { v: 1; t: "hello"; session: string; building_id: string; route_id: string; run: number; mode: string }
  | { v: 1; t: "pose";  ts: number; pos: Vec2; heading: number; cane_deg: number }          // at most 15 Hz
  | { v: 1; t: "tap";   ts: number; at: Vec2; code: CellCode }
  | { v: 1; t: "say";   ts: number; text: string; pri: 0 | 1 | 2 | 3 }
  | { v: 1; t: "event"; ts: number; kind: RunLogKind | "hint"; seg: number; pos: Vec2 }
  | { v: 1; t: "quiz";  ts: number; q: string; seg: number; correct: boolean }
  | { v: 1; t: "point"; ts: number; from: Vec2; heading: number; target_bearing: number; error_deg: number }
  | { v: 1; t: "plan";  ts: number; focus_segment: number; line: string; plan: RunPlan }
  | { v: 1; t: "end";   ts: number; run: number; arrived: boolean; time_s: number; bumps: number;
      off_route: number; quiz_correct: number; quiz_total: number; point_error_deg: number | null };
```

- `hello` repeats every 2 s so a late or reloaded observer picks up the run. `ts` is `performance.now()` of the sender, used only for ordering.
- Messages stay under 1 kB; pose is throttled to 15 Hz; total under 5 kB/s.
- Transport A (default, P0 for the laptop demo): `BroadcastChannel("sv-obs-" + session)`. Works between windows of the same browser profile on one machine. Not across browsers, not between a normal and a private window.
- Transport B (P1, phone to projector laptop): WebSocket relay at `/ws/obs/{session}` in the FastAPI app, proxied by Vite with `ws: true`; Cloudflare quick tunnels carry WebSockets. Sender drops `pose` when `ws.bufferedAmount > 65536`; reconnect with 1, 2, 4 s backoff.

---

## 5. Demo logistics in a loud 800 person venue

### 5.1 Kit

- [ ] 2 pairs of **wired closed back** over ear headphones (one spare). If a pair has noise cancelling, confirm it keeps ANC on in wired mode.
- [ ] 3.5 mm Y splitter plus a third pair, so a second judge can listen in.
- [ ] USB C to 3.5 mm dongle (for USB C phones), and a Lightning one if the iPhone needs it.
- [ ] Disposable eye masks (a pack), alcohol wipes for ear pads, hand sanitiser.
- [ ] Printed A3 JRR plans without labels (10 copies), round stickers, a pen, a printed scale bar.
- [ ] Laptop charger, power strip, HDMI adapter, tape for cables, a second device for the observer.
- [ ] Phone charged, rotation lock on, Do Not Disturb on.

### 5.2 Before every judge (30 s, operator reads it aloud)

- [ ] Laptop Focus or Do Not Disturb on (a notification in the headphones breaks immersion and can steal focus).
- [ ] Sound output = headphones, not the HDMI projector. Volume about 50 percent.
- [ ] Rehearsal window focused and on the Start screen; observer window not focused; new session id.
- [ ] Ear pads wiped, new mask ready.

### 5.3 Consent and safety script

"You'll wear an eye mask for about three minutes. You can lift it at any time or just say stop. For the walk, [name] will be beside you as a sighted guide: hold their arm just above the elbow and they'll stay half a step ahead. We won't photograph you blindfolded unless you say yes."
- Route has no stairs and no glass doors at head height. A second teammate walks ahead and clears people.
- The guide shadows and steps in before any collision; arrival counts even with a verbal "stop" from the guide.

### 5.4 If the judge is hard of hearing

Ask privately before starting: "Any hearing loss or hearing aids? It helps us set the sound." Then:
- one sided loss: mono mode (M), landmarks still described by W (Where am I);
- hearing aids: over ear headphones on behind the ear aids may whistle; offer on ear headphones or a higher volume (the limiter protects them);
- not comfortable with audio: a teammate does the blindfolded run while the judge watches the observer view and asks the pointing question themself;
- on Android, the phone in hand adds vibration on contact as a second channel.

### 5.5 The 60 second scripted route

Pick a JRR route of 3 or 4 segments and 25 to 40 steps, starting close to our table, wall on one side, one turn, one open stretch of 3 to 5 steps, ending at a desk. Rehearse it with a teammate until it reliably takes 60 to 75 s.

| Time | What happens |
|---|---|
| 0:00 | Operator: "Right hand on the arrow keys, left thumb on Space. Up walks a step and your cane sweeps. Left and right turn. Space repeats." Place their hands, then mask and headphones on |
| 0:15 | Start. Ear check (left, right). Run 1 begins |
| 1:15 | "You have reached the reception desk." Pointing task at the entrance (20 s) |
| 1:35 | Quiz, 3 questions (45 s) |
| 2:20 | Coach line, run 2 on the focus segment only (30 s), pointing again |
| 3:00 | Mask off. Sticker on the printed plan where the desk is, or the real walk if time and route allow |

Short version if the judge has 3 minutes: run 1, pointing, sticker on the plan. Teach only four keys (arrows and Space): a blindfolded person finds the arrow cluster by feel; letter keys are for the operator.

### 5.6 Fallbacks

- No phone or no tunnel: the laptop keyboard demo is the primary path anyway.
- No Wi Fi: `npm run build && npx vite preview` with packages saved locally; BroadcastChannel observer needs no network; coach uses its template line.
- Recorded backup (before 06:00, 2 minutes): screen capture of the observer view with the app audio captured, a webcam inset of the blindfolded tester, captions burned in.

---

## Part B. Plan amendments

Written to drop into `docs/plan.md`. Owners follow the plan's team columns. Contract note: nothing here changes the BuildingPackage. RunLog gains one optional field (`point`, which pydantic v2 ignores by default as an unknown field) and one event kind (`hint`, which needs D's Literal widened first; see Task 9).

### Task 8 amendments: Web world, audio, input, Explore (C)

**Files:** Modify `web/src/audio/{engine,cane,echo,landmarks,speech,haptics}.ts`, `web/src/input/{keyboard,orientation}.ts`, `web/index.html`. Create `web/src/audio/space.ts`, `web/src/audio/taps.ts`, `web/src/audio/space.test.ts`, `web/src/audio/cane.test.ts`, `web/src/audio/speech.test.ts`.

**Interfaces:**
- `start(): Promise<StartReport>` with `StartReport = { audio: "running"|"failed"; motion: "granted"|"denied"|"unavailable"; vibrate: boolean; latencyMs: number }`, as in 1.1. Spoken status line after Start. `onAudioPaused()` announces and resumes on next gesture.
- `space.ts`: `toAudio(p: Vec2)`, `forwardFor(h: number)`, `azimuth(listener: Vec2, heading: number, src: Vec2): number` (positive right).
- `cane.ts`: `sweepContact(world, origin, heading, fromDeg, toDeg, maxM = CANE_M, stepDeg = 2): {dist, code, caneDeg, at: Vec2} | null` (first contact along the sweep). `class TapGate { update(hit, tMs): TapEvent | null }` (edge triggered, 60 ms gate, 0.3 m new surface rule). `autoSweep(step: number)` arc −30 to +30 alternating.
- `taps.ts`: `renderTaps(ctx): Record<CellCode | "floor" | "bump" | "step", AudioBuffer>` pre rendered at Start.
- `echo.ts`: `impulse(ctx, t60: number): AudioBuffer` (decorrelated stereo, exp envelope, darkening, T60 capped at 2.0), two convolvers with a 300 ms crossfade.
- `landmarks.ts`: `audible(landmarks, pos, heading, opts: {max: 2, radiusM: 6, includeDestination: boolean}): Landmark[]` limited to sounding kinds.
- `speech.ts`: `say(text, pri: 0|1|2|3 = 2)`, `setRate(r)`, `setOutput("app"|"screenreader")`, `prime(text)`. Chooses a `localService` English voice on `voiceschanged`. Splits at sentence ends to at most 160 chars. Keeps utterance references. Treats `canceled` and `interrupted` errors as normal. Ducks beacons and taps while speaking.
- `haptics.ts`: `pulse(ms)` guarded by `"vibrate" in navigator`, minimum 25 ms.
- Master chain: sources, then ducking gains, then channel swap (S) and mono (M), then a limiter, then destination.
- Keyboard: Up step (rate limit 400 ms, auto sweep on), Down step back, Left and Right turn 15 degrees, A/D manual sweep, Space repeat, H heading, W where am I, B destination hint, M mono, S swap, `+`/`-` rate. `preventDefault` on arrows and Space; ignore `e.repeat` except for Up, Down, Left, Right. Window `blur` pauses with "Paused. Focus lost."
- Stage element: `role="application"`, `tabindex="0"`, `aria-label` with the four keys. Transcript region present from load with `aria-live` set by output mode.
- Phone: full screen Step button plus Repeat, Where am I, Recentre buttons; body yaw (relative alpha) turns; gamma sweeps; no swipes.
- Operator panel (hidden behind `?op=1`): latency ms, motion state, output mode, voice name.

- [ ] **Step 1: Failing tests (vitest)** in addition to the planned seven:
  - `azimuth east is right`: listener (0,0) heading 0, source (3,0) gives +90 ± 1; heading 90, source (0,−3) gives +90 ± 1; `toAudio([3,0])[0] > 0` and `forwardFor(0)` is (0,0,−1).
  - `sweep finds thin pillar`: fixture, origin (8.6,6) heading 90 (pillar face 0.9 m ahead; both ±40 degree end rays miss it), sweep from −40 to +40 in one call finds code 2 at caneDeg within ±10 of 0.
  - `tap gate is edge triggered`: the same hit for 10 frames 16 ms apart yields exactly 1 tap; a code change yields a second.
  - `tap gate rate limit`: alternating hit and miss every 10 ms yields at most 1 tap per 60 ms.
  - `speech priority`: speaking a priority 1 line while a priority 2 line is current does not call `cancel` or `speak`; a priority 3 line calls `cancel` then `speak`.
  - `speech splits long text`: a 400 character, 4 sentence string produces at least 3 utterances, each at most 160 chars.
  - `screen reader mode does not speak`: `setOutput("screenreader")`, `say("x")` writes the live region and never calls `speechSynthesis.speak`; in app mode the region has `aria-live="off"`.
  - `voice prefers local`: mocked voices list with a Google network voice first and a local English voice second picks the local one.
  - `vibrate guarded`: with `navigator.vibrate` undefined, `pulse(25)` does not throw.
  - `audible budget`: 8 sounding landmarks within 6 m returns exactly 2, the nearest; the destination is excluded when `includeDestination` is false.
  - `audioSession set`: with a mocked `navigator.audioSession`, `start()` sets `type` to `"playback"` before constructing `AudioContext`.
  - `motion unavailable on desktop`: no orientation event within 1000 ms gives `motion: "unavailable"` and mode `"keys"`.
  - `key repeat throttled`: 30 Up keydowns 33 ms apart produce at most 3 steps.
  - `blur pauses`: dispatching `blur` on window calls `say("Paused. Focus lost.", 3)` and stops the hesitation timer.
- [ ] **Step 2 to 4:** Fail, implement, pass. Order if short of time: start sequence, key throttle, blur pause, speech priority and local voice, auto sweep with interpolation and tap gate, space mapping, then the rest.
- [ ] **Step 5:** Latency measurement by filming key and tap (1.8). Write the number to `docs/DEMO.md`.
- [ ] **Step 6:** Manual: on an iPhone with the silent switch on, Start, confirm taps and speech both play. On an Android phone, confirm vibration on contact. With VoiceOver on, confirm the Step button walks with a double tap. Commit.

Timebox: P0 items about 2 h on top of what exists; the rest is P1.

### Task 9 amendments: Rehearse mode and pocket summary (C)

**Interfaces:**
- `RunLog.events[].kind` adds `"hint"` (key B). Weight for the coach: same as `hesitate` (1.0). If D's pydantic RunLog types `kind` as a Literal, an unknown `"hint"` makes `/api/coach` reject the whole log with a 422. So D widens the Literal and adds `hint` to `choose_focus` in the same commit as C starts sending it (contract rule 2 applies to RunLog by analogy; log it in `docs/CHANGELOG.md`). Until then C maps `hint` to `hesitate` before posting.
- `RunLog.point?: { at: Vec2; target: string; heading: number; error_deg: number; time_s: number }[]` (optional, ignored by the coach).
- Hesitation timer counts only while no speech is playing and the audio context is running. Otherwise long instructions look like hesitation and the coach over weights long segments.
- After a hesitation, speak once (priority 0): "Press Space to hear the instruction again." Do not auto repeat.
- Off route with `wall_side === "none"`: "Off route. Press Space to hear the last instruction."
- Open area announcement on entering a segment with `open_m > 3` (section 3.2).
- No destination beacon in Rehearse; B gives three chirps and logs `hint`.
- Arrive leads straight into the pointing task (Task 10).
- Pocket summary reads one instruction per utterance.

- [ ] **Step 1: Failing tests** in addition to the planned four: `hesitate not logged while speaking` (mock speech speaking for 6 s, no `hesitate`); `hint logged on B`; `off route with no wall side uses the generic line`; `open area line uses package open_m` (spoken step number equals `round(open_m / STEP_M)`).
- [ ] **Step 2 to 4.** Commit.

### Task 10 amendments: Quiz and coach (C web, D engine)

**Files:** Create `web/src/modes/point.ts`, `web/src/modes/point.test.ts`. Modify `web/src/modes/quiz.ts`, `engine/dr/agents/coach.py` (accept `hint`).

**Interfaces:**
- `class PointTask { constructor(from: Vec2, startHeading: number, target: Landmark); turn(deg: number): void; confirm(tMs: number): PointResult }`, `PointResult = { at: Vec2; target: string; heading: number; target_bearing: number; error_deg: number; time_s: number }`.
- `bearing(from: Vec2, to: Vec2): number` (0 = +y, clockwise, [0, 360)), `angularError(a: number, b: number): number` in [0, 180].
- Flow after arrive: place at the route's start entrance, heading = `entrance.heading_deg`, say "You are back at the entrance, facing into the building. Turn to face the {target label}, then press Space." Turn step 5 degrees, ratchet tick every 15. Feedback after confirm uses `clock_hour` from `clock.ts`.
- Quiz: 3 of the 4 planned questions (drop the destination clock hour question, which the pointing task replaces), options read aloud, R repeats options, keys 1 to 4 or four stacked buttons on phone. P1: route reversal question built from `segments[last]` reversed (`wall_side` flips).
- Point results go to `RunLog.point` and to the observer as `point` messages. Run 2 also ends with a pointing task.

- [ ] **Step 1: Failing tests** `angularError wraps` (350 vs 10 gives 20; 0 vs 180 gives 180); `bearing east is 90` ((0,0) to (5,0)); `point task error` (fixture entrance (0.5, 6.0) heading 90, desk (18.5, 10.8), turning to the exact bearing then confirm gives error under 3); `no feedback before confirm` (no `say` call containing "degrees" before `confirm`); `quiz has 3 questions plus pointing`; engine: `test_hint_counts_like_hesitate`.
- [ ] **Step 2 to 4.** Commit.

### Task 16 amendments: Demo hardening (all)

- [ ] `docs/DEMO.md` contains section 5 of this review: kit list, 30 second pre judge checklist, consent script, hard of hearing options, the timed 60 second route, short and full versions, fallbacks.
- [ ] Measured tap latency on the demo laptop with the demo headphones, written in `docs/DEMO.md`.
- [ ] iPhone checks: silent switch on, screen lock and return (audio resumes after one tap), VoiceOver on (Step button works, app voice and VoiceOver do not double speak in screen reader mode).
- [ ] Android check: vibration on contact, TalkBack on with the Step button.
- [ ] Two blindfold runs by people who have not seen the map: record arrival, time, quiz score, **pointing error after run 1 and run 2**, and one change made because of it.
- [ ] Backup video as in 5.6.
- [ ] Devpost and pitch use the honest lines in 2.3; no "experience blindness" framing.

### Task 17 (new): Observer view (A, 90 min, 23:00 to 01:00; relay part needs 10 min of D's `api.py`)

**Files:** Create `web/observer.html`, `web/src/observer/{protocol,bus,observer}.ts`, `web/src/observer/bus.test.ts`, `web/src/observer/observer.test.ts`. Modify `web/vite.config.ts` (add `observer.html` as an input and proxy `'/ws': { target: 'ws://localhost:8000', ws: true }`), `engine/dr/api.py` (relay endpoint, P1), `engine/tests/test_obs_relay.py`.

**Interfaces:**
- `protocol.ts`: `ObsMsg` as in 4.2, `RunLogKind` imported from the Task 9 types.
- `bus.ts`: `openBus(session: string, opts?: { relay?: boolean }): { publish(m: ObsMsg): void; subscribe(fn: (m: ObsMsg) => void): () => void; close(): void }`. Always uses `BroadcastChannel("sv-obs-" + session)`; with `relay` also a WebSocket to `/ws/obs/{session}`. Pose throttled to 15 Hz inside `publish`. Never throws if neither transport exists.
- Rehearsal side: one `publish` call at each existing hook (`say`, tap, step and turn, RunLog events, quiz answer, point result, coach plan, run end). URL `?obs=<session>` turns publishing on, `&relay=1` adds the WebSocket.
- `observer.ts`: `class ObserverState { apply(m: ObsMsg): void; trails: Record<number, Vec2[]>; lastSay: string; taps: {at: Vec2; code: CellCode; ts: number}[]; summary: Record<number, EndMsg> }` (pure, testable) and a canvas renderer that draws the items in 4.1. URL `observer.html?b=jrr&obs=<session>`.
- Relay (P1) in `api.py`:

```python
from collections import defaultdict
from fastapi import WebSocket, WebSocketDisconnect
_rooms: dict[str, set[WebSocket]] = defaultdict(set)

@app.websocket("/ws/obs/{session}")
async def obs_relay(ws: WebSocket, session: str):
    await ws.accept()
    _rooms[session].add(ws)
    try:
        while True:
            msg = await ws.receive_text()
            if len(msg) > 4096:
                continue
            for peer in list(_rooms[session]):
                if peer is not ws:
                    try:
                        await peer.send_text(msg)
                    except Exception:
                        _rooms[session].discard(peer)
    except WebSocketDisconnect:
        pass
    finally:
        _rooms[session].discard(ws)
```
  Uvicorn needs a WebSocket library (`uvicorn[standard]` or `websockets`); add it to the engine requirements.

- [ ] **Step 1: Failing tests**
  - `bus roundtrip` (Node 18+ has a global `BroadcastChannel`): two buses with the same session, `publish` a `say`, the other receives it; a different session does not.
  - `pose throttle`: 100 pose publishes within 1 s deliver at most 16.
  - `bus without transports`: with `BroadcastChannel` undefined and no relay, `publish` does not throw.
  - `observer state trails per run`: `hello` run 1, 3 poses, `hello` run 2, 2 poses gives trails of lengths 3 and 2.
  - `observer keeps taps 300 ms`: taps older than 300 ms are pruned on `apply`.
  - `test_obs_relay` (FastAPI `TestClient` websocket): a message from client A reaches client B in the same session, not client C in another, and never echoes to A.
- [ ] **Step 2:** Fail. **Step 3:** Implement bus and state, then renderer, then relay. **Step 4:** Pass.
- [ ] **Step 5:** Manual: rehearsal window on the laptop screen, observer window on the projector, play a full run 1, coach, run 2; check the before and after table fills. Then phone plus relay through the tunnel. Commit.

### Review Focus additions

6. **Double speech with a screen reader.** In screen reader mode `speechSynthesis.speak` is never called; in app voice mode the transcript is not live. Test in Task 8.
7. **Focus lost on the demo laptop.** Window blur pauses and says so. Test in Task 8.
8. **Interrupted audio on iPhone.** Lock and unlock resumes after one tap with a spoken prompt. Manual check in Task 16.
9. **Left and right swapped.** `azimuth east is right` test plus the ear check at Start. Test in Task 8.

---

## Sources

- [S1] WebKit bug 237322, "webaudio api is muted when the iOS ringer is muted" (closed as configuration changed; `audioSession.type = "playback"` since iOS 17): https://lists.webkit.org/pipermail/webkit-unassigned/2024-September/1186593.html
- [S2] "Web audio iOS unmute" (default maps to ambient; silent audio element workaround; only Safari implements Audio Session): https://portfolio-2024-b6r.pages.dev/blog/web-audio-ios-unmute ; MDN AudioSession.type: https://developer.mozilla.org/docs/Web/API/AudioSession/type
- [S3] Caktus Group, "The Halting Problem" (Chrome speechSynthesis stops on Google voices; pause and resume every 14 s): https://www.caktusgroup.com/blog/2025/11/03/the-halting-problem/
- [S4] Readium, "SpeechSynthesis in browsers and OSes" (14 s bug, online Google voices, Safari default flag, Android voice list): https://readium.org/speech/docs/WebSpeech.html
- [S5] easy-speech FAQ (iOS gesture requirement and priming, Safari delay): https://github.com/leaonline/easy-speech/blob/master/FAQ.md
- [S6] caniuse, Navigator API vibrate: https://caniuse.com/mdn-api_navigator_vibrate
- [S7] MDN, DeviceOrientationEvent.requestPermission(): https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static
- [S8] W3C public-geolocation, compass headings question (webkitCompassHeading on iOS, deviceorientationabsolute on Chrome): https://lists.w3.org/Archives/Public/public-geolocation/2024Jan/0035.html
- [S9] MDN, BaseAudioContext.state (interrupted, iOS resume): https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/state
- [S10] HdM Stuttgart, "Web Audio API tips for performance" (HRTF and convolver cost, equalpower alternative): https://blog.mi.hdm-stuttgart.de/index.php/2021/02/24/web-audio-api-tips-for-performance/
- [S11] web.dev, "Synchronize audio and video playback on the web" (outputLatency support): https://web.dev/articles/audio-output-latency
- [S12] LessWrong, "Browser audio latency" (laptop measurements; Bluetooth under reports): https://www.lesswrong.com/posts/ooXEzrX7Y9Go6D7st/browser-audio-latency
- [S13] Apple, "About the VoiceOver rotor" (Direct Touch is a typing mode): https://support.apple.com/en-us/111796
- [S14] AppleVis forum, "VoiceOver direct interaction on web game?": https://applevis.com/forum/app-development-programming/voiceover-direct-interaction-web-game
- [S15] Apple Developer Forums thread 779670 (VoiceOver gestures in Safari web content): https://developer.apple.com/forums/thread/779670
- [S16] Apple iPhone User Guide, VoiceOver gestures ("double tap and hold until three rising tones, then make the gesture"): https://support.apple.com/en-qa/guide/iphone/learn-voiceover-gestures-iph3e2e2281/16.0/ios
- [S17] "The Perils of Playing Blind: Problems with Blindness Simulation and a Better Way to Teach about Blindness", Journal of Blindness Innovation and Research: https://nfb.org/images/nfb/publications/jbir/jbir15/jbir050201.html
