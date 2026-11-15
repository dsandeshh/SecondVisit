// Explore mode: free walking with cane, footsteps, room reverb and real landmark sounds (Task 8).
import { ARRIVE_M, CANE_M } from "../config";
import { clockHour } from "../clock";
import { AUTO_SWEEP_MS, autoSweep, sweepContact, TapGate } from "../audio/cane";
import type { AudioEngine } from "../audio/engine";
import { pulse, PULSE } from "../audio/haptics";
import { LandmarkSounds } from "../audio/landmarks";
import type { Speech } from "../audio/speech";
import type { KeyActions } from "../input/keyboard";
import type { Entrance, Landmark, Vec2 } from "../types";
import { bearing, dist, Traveller, wrap180, type World } from "../world";
import { HesitationTimer } from "./hesitation";

const SWEEP_DEG_PER_S = 120;
const FRAME_MS = 16;

export type ExploreHooks = {
  onMove?: (t: Traveller) => void;
  onBump?: (t: Traveller) => void;
  onHint?: (t: Traveller) => void;
  now?: () => number;
};

export const lmName = (l: Landmark): string =>
  (l.confidence < 0.6 ? "possibly " : "") + l.label.charAt(0).toLowerCase() + l.label.slice(1);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class Explore implements KeyActions {
  readonly traveller: Traveller;
  readonly entrance: Entrance;
  readonly timer = new HesitationTimer();
  readonly destination: Landmark | null;
  active = false;
  private gate = new TapGate();
  private steps = 0;
  private anim: ReturnType<typeof setInterval> | null = null;
  private held: ReturnType<typeof setInterval> | null = null;
  private heard = new Set<string>();
  private room: string | null = null;
  private stairsWarned = false;
  private sounds: LandmarkSounds | null = null;
  private now: () => number;

  constructor(readonly world: World, readonly audio: AudioEngine, readonly speech: Speech, private hooks: ExploreHooks = {}) {
    const pkg = world.pkg;
    this.entrance = pkg.entrances[0] ?? { id: "start", label: "start", pos: [pkg.grid.origin[0] + 1, pkg.grid.origin[1] + 1], heading_deg: 0 };
    this.traveller = new Traveller(world, this.entrance.pos, this.entrance.heading_deg);
    const toId = pkg.routes[0]?.to;
    this.destination = pkg.landmarks.find(l => l.id === toId) ?? pkg.landmarks.find(l => l.kind === "desk") ?? null;
    this.now = hooks.now ?? (() => performance.now());
    if (audio.ctx && audio.beaconBus)
      this.sounds = new LandmarkSounds(audio.ctx, audio.beaconBus, this.destination?.id,
        new URLSearchParams(globalThis.location?.search ?? "").get("pan") === "eq" ? "equalpower" : "HRTF");
  }

  intro(phone: boolean): string {
    const how = phone ? "Tap Step to walk. Turn your body to turn." : "Up arrow walks, left and right turn, W tells you where you are.";
    return `Explore. You are at the ${this.entrance.label.toLowerCase()}, facing into the building. ${how}`;
  }

  begin(): void {
    this.active = true;
    this.moved();
    this.timer.start();
  }

  stop(): void {
    this.active = false;
    this.timer.stop();
    this.sounds?.stop();
    if (this.anim) clearInterval(this.anim);
    if (this.held) clearInterval(this.held);
  }

  any(): void {}

  step(dir: 1 | -1): void {
    const t = this.traveller;
    const r = t.step(dir);
    this.timer.reset();
    if (r === "bump") {
      this.audio.play("bump", { gain: 1, send: 0.3 });
      const ahead = this.world.raycast(t.pos, dir > 0 ? t.heading : t.heading + 180, CANE_M);
      if (ahead) this.audio.play(ahead.code, { dist: ahead.dist, pan: 0 });
      pulse(PULSE.bump);
      this.hooks.onBump?.(t);
      return;
    }
    this.steps++;
    this.audio.play("step", { pan: this.steps % 2 ? 0.2 : -0.2, gain: 0.8, send: 1 });
    this.moved();
    if (dir > 0) this.autoSweep();
  }

  turn(deg: number): void {
    this.traveller.turn(deg);
    this.moved(false);
    this.probe(this.traveller.caneDeg, this.traveller.caneDeg);
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

  repeat(): void {
    if (this.speech.last) this.speech.repeat();
    else this.where();
  }

  heading(): void {
    const h = clockHour(wrap180(this.traveller.heading - this.entrance.heading_deg));
    this.speech.say(h === 12 ? "Facing into the building, 12 o'clock." : `Facing ${h} o'clock. 12 o'clock is into the building from the entrance.`, 2);
  }

  where(): void {
    const t = this.traveller;
    const room = this.world.roomAt(t.pos)?.label ?? this.world.pkg.name;
    const near = [...this.world.pkg.landmarks].sort((a, b) => dist(t.pos, a.pos) - dist(t.pos, b.pos))[0];
    const tail = near ? ` ${cap(lmName(near))} at ${this.clockTo(near.pos)} o'clock.` : "";
    this.speech.say(`${room}.${tail}`, 2);
  }

  hint(): void {
    if (!this.destination) { this.speech.say("No destination in this building.", 2); return; }
    this.sounds?.chirps(this.destination.pos);
    this.hooks.onHint?.(this.traveller);
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
    this.speech.say(delta > 0 ? "Faster." : "Slower.", 2);
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
    this.sounds?.update(this.world.pkg.landmarks, t.pos, t.heading, true);
    if (announce) {
      if (room && room.id !== this.room) this.speech.say(`You are entering the ${room.label.toLowerCase()}.`, 1);
      for (const l of this.world.pkg.landmarks) {
        if (dist(t.pos, l.pos) <= ARRIVE_M && !this.heard.has(l.id)) {
          this.heard.add(l.id);
          this.speech.say(`${cap(lmName(l))} at ${this.clockTo(l.pos)} o'clock.`, 1);
          pulse(PULSE.landmark);
        } else if (dist(t.pos, l.pos) > ARRIVE_M * 2) this.heard.delete(l.id);
      }
    }
    if (room) this.room = room.id;
    const label = this.world.roomAt(t.pos)?.label;
    const el = globalThis.document?.getElementById("room-label");
    if (el) el.textContent = `Room: ${label ?? "not named"}`;
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
      this.audio.play(ev.code, { dist: ev.dist, pan: Math.sin(ev.caneDeg * Math.PI / 180) });
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
