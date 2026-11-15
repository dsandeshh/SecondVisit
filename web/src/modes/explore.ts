// Explore mode: free walking with cane, footsteps, room reverb and real landmark sounds (Task 8).
import { ARRIVE_M, CANE_M } from "../config";
import { clockHour } from "../clock";
import { AUTO_SWEEP_MS, autoSweep, sweepContact, TapGate } from "../audio/cane";
import { ContinuousSounds } from "../audio/continuous";
import type { AudioEngine } from "../audio/engine";
import { pulse, PULSE } from "../audio/haptics";
import { LandmarkSounds } from "../audio/landmarks";
import { RATE_MAX, RATE_MIN, type Speech } from "../audio/speech";
import type { KeyActions } from "../input/keyboard";
import { possiblyOpts, spokenOf } from "../names";
import type { Entrance, Landmark, Vec2 } from "../types";
import { bearing, dist, Traveller, wrap180, type World } from "../world";
import { HesitationTimer } from "./hesitation";
import { Interact } from "./interact";
import { echoSeconds } from "./rooms";

const SWEEP_DEG_PER_S = 120;
const FRAME_MS = 16;

export type ExploreHooks = {
  onMove?: (t: Traveller) => void;
  onBump?: (t: Traveller) => void;
  onHint?: (t: Traveller) => void;
  /** After every successful step (Rehearse reads this). */
  onStep?: (t: Traveller) => void;
  onTap?: (at: Vec2, code: number) => void;
  now?: () => number;
};

/** The short spoken name, first letter lower case; "possibly" is a separate prefix, never part of the name. */
export const lmName = (l: Landmark): string => spokenOf(l).charAt(0).toLowerCase() + spokenOf(l).slice(1);
const TAP_WORD: Record<number, string> = { 1: "wall", 2: "obstacle", 3: "obstacle", 4: "glass", 5: "stairs" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class Explore implements KeyActions {
  readonly traveller: Traveller;
  readonly entrance: Entrance;
  readonly timer = new HesitationTimer();
  readonly destination: Landmark | null;
  /** The Top 8 interactions (around me, ahead, picker, beacon, bump, where, room entry, doorways, callouts). */
  readonly fx: Interact;
  private prev: Vec2 = [0, 0];
  active = false;
  /** Rehearse: no continuous beacon, no landmark callouts (the run speaks the cues). Entering it stops the beacon at
   *  once; leaving it brings back the Explore on/off choice (cont.beaconOn is never touched in Rehearse). */
  private _rehearse = false;
  get rehearse(): boolean { return this._rehearse; }
  set rehearse(on: boolean) { this._rehearse = on; if (on) this.cont?.silenceBeacon(); }
  /** Pointing and quiz: walking is off. */
  locked = false;
  private gate = new TapGate();
  private steps = 0;
  private anim: ReturnType<typeof setInterval> | null = null;
  private held: ReturnType<typeof setInterval> | null = null;
  private heard = new Set<string>();
  private room: string | null = null;
  private stairsWarned = false;
  private sounds: LandmarkSounds | null = null;
  /** The two continuous sounds: the target beacon and the obstacle proximity tick. */
  readonly cont: ContinuousSounds;
  private now: () => number;
  clock(): number { return this.now(); }
  logHint(): void { this.hooks.onHint?.(this.traveller); }

  constructor(readonly world: World, readonly audio: AudioEngine, readonly speech: Speech, private hooks: ExploreHooks = {}) {
    const pkg = world.pkg;
    this.entrance = pkg.entrances[0] ?? { id: "start", label: "start", pos: [pkg.grid.origin[0] + 1, pkg.grid.origin[1] + 1], heading_deg: 0 };
    this.traveller = new Traveller(world, this.entrance.pos, this.entrance.heading_deg);
    const toId = pkg.routes[0]?.to;
    this.destination = pkg.landmarks.find(l => l.id === toId) ?? pkg.landmarks.find(l => l.kind === "desk") ?? null;
    this.now = hooks.now ?? (() => performance.now());
    this.fx = new Interact(this);
    this.prev = [this.entrance.pos[0], this.entrance.pos[1]];
    const page = () => globalThis.document?.body?.dataset.page;
    this.cont = new ContinuousSounds(audio, world, {
      pose: () => this.traveller,
      target: () => this.fx.beaconTarget?.at ?? null,
      live: () => this.active && !this.locked && (page() === undefined || page() === "inside"),
      rehearse: () => this._rehearse,
      onPulse: at => speech.bus.publish({ kind: "pulse", at, id: this.fx.beaconTarget?.id }),
    });
    if (audio.ctx && audio.buses) {
      if (new URLSearchParams(globalThis.location?.search ?? "").get("pan") === "eq") audio.panning = "equalpower";
      this.sounds = new LandmarkSounds(audio, this.destination?.id);
    }
  }

  intro(phone: boolean): string {
    const how = phone ? "Tap Step to walk. Turn your body to turn." : "Up arrow walks, left and right turn, W tells you where you are.";
    return `Explore. You are at the ${this.entrance.label.toLowerCase()}, facing into the building. ${how}`;
  }

  begin(): void {
    this.active = true;
    this.moved();
    this.timer.start();
    this.cont.start();
    this.fx.showTarget();
  }

  stop(): void {
    this.active = false;
    this.timer.stop();
    this.cont.stop();
    this.sounds?.stop();
    this.fx.stop();
    if (this.anim) clearInterval(this.anim);
    if (this.held) clearInterval(this.held);
  }

  any(_key?: string): void {}

  /** Put the traveller somewhere (start of a run, back at the entrance). */
  place(pos: Vec2, heading: number): void {
    this.traveller.pos = [pos[0], pos[1]];
    this.traveller.setHeading(heading);
    this.traveller.setCane(0);
    this.heard.clear();
    this.fx.reset();
    this.prev = [pos[0], pos[1]];
    this.moved(false);
  }

  private ticks = 0;
  /** One quiet cane tick per Up press, alternating a little left and right, low in the mix: a press is never silent. */
  caneTick(): void {
    this.ticks++;
    this.audio.play("step", { pan: this.ticks % 2 ? 0.15 : -0.15, gain: 0.5, send: 0 });
  }

  step(dir: 1 | -1): void {
    if (this.locked) return;
    this.caneTick();                               // first, even when the step is blocked (then the bump follows)
    const t = this.traveller;
    const r = t.step(dir);
    this.timer.reset();
    if (r === "bump") {
      if (!this.fx.bump(dir)) {                    // no ray hit found (should not happen): the old tap
        this.audio.play("bump", { gain: 1, send: 0.3 });
        pulse(PULSE.bump);
      }
      this.hooks.onBump?.(t);
      return;
    }
    this.steps++;
    this.moved();
    this.hooks.onStep?.(t);
    if (dir > 0) this.autoSweep();
  }

  turn(deg: number): void {
    this.traveller.turn(deg);
    this.moved(false);
    if (!this.probe(this.traveller.caneDeg, this.traveller.caneDeg)) this.audio.play("floor", { gain: 0.25, pan: deg < 0 ? -0.4 : 0.4 });   // a soft tick: the turn was heard even with nothing in reach
  }

  /** Absolute heading (phone body yaw). */
  face(h: number): void {
    this.traveller.setHeading(h);
    this.audio.listen(this.traveller.pos, this.traveller.heading);
  }

  /** Manual cane angle (mouse x, phone gamma): rays are interpolated from the last angle in 2 degree steps. */
  setCane(deg: number): void {
    if (this.anim) { clearInterval(this.anim); this.anim = null; }
    const from = this.traveller.caneDeg;
    this.traveller.setCane(deg);
    this.probe(from, this.traveller.caneDeg);
  }

  /** A/D held: sweep at 120 degrees per second until released. */
  sweep(dir: -1 | 0 | 1): void {
    if (this.held) { clearInterval(this.held); this.held = null; }
    if (dir === 0) return;
    this.held = setInterval(() => this.setCane(this.traveller.caneDeg + dir * SWEEP_DEG_PER_S * FRAME_MS / 1000), FRAME_MS);
  }

  /** Space: the last line again, nothing added (Rehearse repeats the instruction in the session). */
  repeat(): void {
    if (this.speech.last) { this.speech.repeat(); return; }
    const b = this.fx.beaconTarget;
    this.speech.say(b ? this.fx.placeLine(b) : "No places in this building.", 2);
  }

  heading(): void {
    const h = clockHour(wrap180(this.traveller.heading - this.entrance.heading_deg));
    this.speech.say(h === 12 ? "Facing into the building, 12 o'clock." : `Facing ${h} o'clock. 12 o'clock is into the building from the entrance.`, 2);
  }

  where(rehearse?: Parameters<Interact["where"]>[0]): void { this.fx.where(rehearse); }

  /** The hint. In Rehearse (B or Enter): one burst of BURST_PULSES beacon pulses from the destination's true direction,
   *  logged as a hint; ignored while a burst is still playing, so holding B never becomes a beacon. */
  hint(): void {
    if (!this.destination) { this.speech.say("No destination in this building.", 2); return; }
    if (this.rehearse) { if (this.cont.bursting) return; this.cont.burst(this.destination.pos); }   // no audio: still a hint
    else this.sounds?.chirps(this.destination.pos);
    this.hooks.onHint?.(this.traveller);
  }

  /** B in Explore: the continuous beacon on or off (on by default). In Rehearse B is the hint. */
  beacon(): void {
    if (this.rehearse) { this.hint(); return; }
    this.cont.beaconOn = !this.cont.beaconOn;
    this.speech.say(this.cont.beaconOn ? "Beacon on." : "Beacon off.", 2);
  }

  mono(): void {
    this.audio.setMono(!this.audio.mono);
    this.speech.say(this.audio.mono ? "Mono on." : "Mono off.", 2);
  }

  swap(): void {
    this.audio.setSwap(!this.audio.swapped);
    this.speech.say(this.audio.swapped ? "Left and right swapped." : "Left and right normal.", 2);
  }

  rate(delta: number): void {
    this.speech.setRate(this.speech.rate + delta);
    try { localStorage.setItem("sv.rate", String(this.speech.rate)); } catch { /* private mode */ }
    const r = this.speech.rate;
    this.speech.say(r >= RATE_MAX ? "Fastest." : r <= RATE_MIN ? "Slowest." : delta > 0 ? "Faster." : "Slower.", 2);
  }

  clockTo(p: Vec2): number {
    return clockHour(wrap180(bearing(this.traveller.pos, p) - this.traveller.heading));
  }

  private moved(announce = true): void {
    const t = this.traveller;
    this.audio.listen(t.pos, t.heading);
    const room = this.world.roomAt(t.pos);
    if (room) this.audio.echo?.setArea(room.area_m2);
    else if (this.room === null) this.audio.echo?.setArea(this.world.areaAt(t.pos)); // doorway keeps the last room
    this.sounds?.update(this.world.pkg.landmarks, t.pos, t.heading, !this.rehearse);
    // room entry with jamb clicks, doorway cues and landmark callouts (one per step, never over an instruction)
    if (this.prev[0] !== t.pos[0] || this.prev[1] !== t.pos[1] || announce) this.fx.onStep(this.prev, room, announce);
    this.prev = [t.pos[0], t.pos[1]];
    if (room) this.room = room.id;
    const label = this.world.roomAt(t.pos)?.label;
    const el = globalThis.document?.getElementById("room-label");
    if (el) el.textContent = label ? `Room: ${label} \u00b7 echo ${echoSeconds(room!)} s CALC` : "Room: not named";
    this.hooks.onMove?.(t);
  }

  /** Check the arc between two cane angles and play a tap on a new contact. */
  private probe(from: number, to: number): boolean {
    const t = this.traveller;
    const hit = sweepContact(this.world, t.pos, t.heading, from, to);
    const ev = this.gate.update(hit, this.now());
    if (hit?.code === 5) {
      if (!this.stairsWarned) { this.stairsWarned = true; this.speech.say("Stairs ahead.", 3); }
    } else if (!hit) this.stairsWarned = false;
    if (ev) {
      this.audio.play(ev.code, { dist: ev.dist, pan: Math.sin(ev.caneDeg * Math.PI / 180), at: ev.at, label: TAP_WORD[ev.code] ?? "tap" });
      this.hooks.onTap?.(ev.at, ev.code);
      pulse(PULSE.contact);
    }
    return !!hit;
  }

  /** Two point touch: sweep -30 to +30 (alternating) over 350 ms; floor tick at the end if nothing was touched. */
  private autoSweep(): void {
    if (this.held) return; // manual sweep overrides
    if (this.anim) clearInterval(this.anim);
    const [a, b] = autoSweep(this.steps);
    const t0 = this.now();
    let last = a, touched = this.probe(a, a);
    this.anim = setInterval(() => {
      const k = Math.min(1, (this.now() - t0) / AUTO_SWEEP_MS);
      const cur = a + (b - a) * k;
      touched = this.probe(last, cur) || touched;
      last = cur;
      this.traveller.setCane(cur);
      if (k >= 1) {
        clearInterval(this.anim!); this.anim = null;
        if (!touched) this.audio.play("floor", { pan: Math.sin(b * Math.PI / 180) * 0.6, send: 0.4 });
      }
    }, FRAME_MS);
  }
}
