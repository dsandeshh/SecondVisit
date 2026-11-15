// Outdoor walk controller: renderer, camera rig, the step model, speech timing and sound, for one curb to door walk.
// Draws into `stage` (an overlay that is removed after the walk). Keys: Up step, Left/Right turn 15, Space repeat,
// B door sound, any key skips the fly in. Reduced motion: every camera move is a cut.
import * as THREE from "three";
import type { AudioEngine } from "../../audio/engine";
import { OutdoorAudio, trafficPoints, roadLine } from "../../audio/outdoor";
import type { CueBus } from "../../events";
import { azimuth } from "../../audio/space";
import { wrap180 } from "../../world";
import type { BuildingPackage, Vec2 } from "../../types";
import { DOOR_S, FLY_S, REVEAL_AT, doorPose, followPose, lerpPose, overheadPose, type Pose, type RevealKey } from "./camera";
import { plan, recoveryFor } from "./lines";
import { OutdoorScene } from "./scene";
import { stepOutdoor, worldOf, type OutdoorWorld } from "./step";
import "./outdoor.css";

export type OutdoorState = "fly" | "walk" | "door" | "inside";
export type ControllerOpts = {
  pkg: BuildingPackage; stage: HTMLElement; say: (text: string, pri?: 1 | 2 | 3) => void; bus?: CueBus; audio?: AudioEngine | null;
  onInside?: () => void; reducedMotion?: boolean; autoWalk?: boolean; skipFlyIn?: boolean;
};

const TURN_DEG = 15;
const wordsPerS = 2.7;

export class OutdoorController {
  state: OutdoorState = "fly";
  readonly curb: Vec2; readonly door: Vec2;
  readonly done: Promise<void>;
  readonly root: HTMLElement;
  pos: Vec2; heading: number;
  steps = 0;
  private resolveDone!: () => void;
  private sc: OutdoorScene;
  private renderer: THREE.WebGLRenderer;
  private cam = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
  private world: OutdoorWorld;
  private reduced: boolean;
  private say: ControllerOpts["say"];
  private audioOut: OutdoorAudio | null = null;
  private raf = 0; private last = 0; private t0 = 0;
  private revealed = new Set<RevealKey>();
  private camFrom: Pose; private camTo: Pose | null = null; private camT = 0; private camDur = 0;
  private cur: Pose;
  private lineByWhen = plan([]);
  private spoken = new Set<string>();
  private queue: string[] = []; private talking = false; private lastLine = "";
  private keyH: (e: KeyboardEvent) => void;
  private ro: ResizeObserver | null = null;
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private inCanopy = false; private beacon = false;
  private el: { cap: HTMLElement; count: HTMLElement; unit: HTMLElement; skip: HTMLButtonElement; hint: HTMLElement };
  private disposed = false;

  constructor(readonly o: ControllerOpts) {
    const a = o.pkg.arrival;
    if (!a) throw new Error("no arrival in this package");
    this.say = o.say;
    this.reduced = o.reducedMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.sc = new OutdoorScene(o.pkg);
    this.curb = this.sc.curb; this.door = this.sc.door;
    const entry = o.pkg.entrances[0]?.heading_deg ?? 270;
    this.world = worldOf(a, this.door, entry);
    this.pos = [...this.curb] as Vec2;
    // face the building: the entrance heading (perpendicular to the facade), as the arrival script says
    this.heading = entry;
    this.lineByWhen = plan(a.lines ?? []);
    this.done = new Promise(r => { this.resolveDone = r; });

    this.root = document.createElement("div");
    this.root.className = "outdoor";
    this.root.dataset.state = "fly";
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.domElement.className = "outdoor__canvas";
    this.root.append(this.renderer.domElement, this.chrome());
    const cs = getComputedStyle(o.stage);
    if (cs.position === "static") o.stage.style.position = "relative";
    o.stage.append(this.root);
    this.el = {
      cap: this.root.querySelector(".outdoor__caption")!, count: this.root.querySelector(".outdoor__steps")!, unit: this.root.querySelector(".outdoor__unit")!,
      skip: this.root.querySelector(".outdoor__skip")!, hint: this.root.querySelector(".outdoor__hint")!,
    };

    this.sc.setWalker(this.pos, this.heading);
    this.camFrom = overheadPose(this.curb); this.cur = this.camFrom;
    this.applyPose(this.cur);
    this.resize();
    if (typeof ResizeObserver !== "undefined") { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.root); }

    this.keyH = e => this.onKey(e);
    window.addEventListener("keydown", this.keyH, true);
    if (o.bus) o.bus.subscribe(c => { if (c.kind === "say" && c.text && this.state !== "inside") this.caption(c.text); });
    this.updateCount();
  }

  // ---- lifecycle ------------------------------------------------------------------------------------------
  start(): void {
    this.t0 = performance.now(); this.last = this.t0;
    const e = this.o.audio;
    if (e?.ctx) {
      const cue = this.o.pkg.arrival?.cues?.find(c => c.kind === "traffic");
      const line = cue?.plan?.[0] ? roadLine(cue.plan[0], this.curb, 40) : null;
      this.audioOut = new OutdoorAudio(e, { door: this.door, road: line ? trafficPoints(line, this.door) : [] });
      this.audioOut.start(this.pos, this.heading);
    }
    if (this.reduced || this.o.skipFlyIn) { this.land(true); } else {
      this.camTo = followPose(this.pos, this.heading); this.camT = 0; this.camDur = FLY_S;
      this.sc.reveal("ground", true, true);
    }
    this.sayStart();
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  private sayStart(): void {
    const lines = this.lineByWhen.start;
    if (lines.length) this.speak(lines);
  }

  /** Cut to the walking pose and show everything (reduced motion, any key, or the end of the flight). */
  private land(instant: boolean): void {
    for (const k of Object.keys(REVEAL_AT) as RevealKey[]) { this.sc.reveal(k, true, instant); this.revealed.add(k); }
    const p = followPose(this.pos, this.heading);
    if (instant) { this.camTo = null; this.cur = p; this.applyPose(p); } else { this.camFrom = this.cur; this.camTo = p; this.camT = 0; this.camDur = 0.8; }
    this.state = "walk"; this.root.dataset.state = "walk";
    this.el.skip.hidden = true;
    this.hint();
    if (this.o.autoWalk) this.autoWalk();
  }

  skip(): void { if (this.state === "fly") this.land(this.reduced); }

  private hint(): void {
    this.el.hint.hidden = false;
  }

  // ---- loop ------------------------------------------------------------------------------------------------
  private frame(t: number): void {
    if (this.disposed) return;
    const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
    if (this.state === "fly") {
      const el = (t - this.t0) / 1000;
      for (const [k, at] of Object.entries(REVEAL_AT) as [RevealKey, number][]) if (el >= at && !this.revealed.has(k)) { this.revealed.add(k); this.sc.reveal(k, true); }
      this.camT += dt;
      if (this.camTo) { this.cur = lerpPose(this.camFrom, this.camTo, this.camT / this.camDur); this.applyPose(this.cur); }
      if (this.camT >= FLY_S) this.land(false);
    } else if (this.camTo) {
      this.camT += dt;
      this.cur = lerpPose(this.camFrom, this.camTo, this.camT / this.camDur); this.applyPose(this.cur);
      if (this.camT >= this.camDur) { this.camTo = null; this.afterMove(); }
    } else if (this.state === "walk") {
      // follow: ease the camera behind the walker as they move and turn
      const p = followPose(this.pos, this.heading);
      const k = this.reduced ? 1 : Math.min(1, dt * 5);
      this.cur = { pos: this.cur.pos.map((v, i) => v + (p.pos[i] - v) * k) as Pose["pos"], look: this.cur.look.map((v, i) => v + (p.look[i] - v) * k) as Pose["look"], up: [0, 1, 0] };
      this.applyPose(this.cur);
    }
    this.sc.update(dt);
    this.renderer.render(this.sc.scene, this.cam);
    this.raf = requestAnimationFrame(n => this.frame(n));
  }

  private applyPose(p: Pose): void {
    this.cam.position.set(...p.pos); this.cam.up.set(...p.up); this.cam.lookAt(...p.look);
  }

  private resize(): void {
    const w = Math.max(1, this.root.clientWidth), h = Math.max(1, this.root.clientHeight);
    this.renderer.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    this.sc.setResolution(w, h);
  }

  // ---- speech ----------------------------------------------------------------------------------------------
  /** Say lines one after another; a new group replaces whatever is still queued. */
  private speak(lines: string[], replace = false): void {
    const fresh = lines.filter(l => !this.spoken.has(l));
    if (!fresh.length) return;
    fresh.forEach(l => this.spoken.add(l));
    if (replace) this.queue = [];
    this.queue.push(...fresh);
    void this.pump();
  }
  private async pump(): Promise<void> {
    if (this.talking) return;
    this.talking = true;
    while (this.queue.length && !this.disposed) {
      const l = this.queue.shift()!;
      this.lastLine = l;
      const sp = this.o.audio?.speech;
      this.say(l, 2);
      if (sp) await sp.sayAsync(l, 2).catch(() => undefined);
      else await new Promise(r => setTimeout(r, (l.split(/\s+/).length / wordsPerS) * 1000 + 600));
    }
    this.talking = false;
  }
  private async idle(maxMs: number): Promise<void> {
    const end = Date.now() + maxMs;
    while ((this.talking || this.queue.length) && Date.now() < end) await new Promise(r => setTimeout(r, 120));
  }
  /** A safety or recovery line interrupts at once. */
  private urgent(line: string | null): void {
    if (!line) return;
    this.queue = []; this.lastLine = line;
    this.say(line, 3);
  }
  private caption(text: string): void { this.el.cap.textContent = text; }

  // ---- movement --------------------------------------------------------------------------------------------
  step(): void {
    if (this.state !== "walk") return;
    const r = stepOutdoor(this.world, this.pos, this.heading);
    const e = this.o.audio;
    if (r.blocked) {
      e?.play("bump", { at: this.ahead(0.7), send: 0.3 });
      this.urgent(recoveryFor(this.o.pkg.arrival?.recovery ?? [], "wall"));
      return;
    }
    this.pos = r.pos; this.steps++;
    this.sc.setWalker(this.pos, this.heading);
    this.audioOut?.setPose(this.pos, this.heading);
    e?.play("step", { gain: 0.8, send: 0.2 });
    if (r.crossedEdge) { this.audioOut?.edge(this.pos); this.speak(this.lineByWhen.edge, true); }
    if (r.enteredCanopy) { this.inCanopy = true; this.audioOut?.canopy(true); this.speak(this.lineByWhen.canopy, true); }
    if (r.leftCanopy) { this.inCanopy = false; this.audioOut?.canopy(false); }
    if (!this.world.edge && this.steps === 4) this.speak([...this.lineByWhen.lane, ...this.lineByWhen.edge]);
    this.updateCount();
    if (r.atDoor) void this.arrive();
    else if (this.beacon && Math.hypot(this.pos[0] - this.door[0], this.pos[1] - this.door[1]) < 1) this.setBeacon(false);
  }
  private ahead(m: number): Vec2 { const r = this.heading * Math.PI / 180; return [this.pos[0] + m * Math.sin(r), this.pos[1] + m * Math.cos(r)]; }

  turn(deg: number): void {
    if (this.state !== "walk") return;
    this.heading = (((this.heading + deg) % 360) + 360) % 360;
    this.sc.setWalker(this.pos, this.heading);
    this.audioOut?.setPose(this.pos, this.heading);
    // toward the road: the recovery line (only when facing within 45 degrees of it)
    const road = this.o.pkg.arrival?.cues?.find(c => c.kind === "traffic")?.plan?.[0];
    if (road && Math.abs(azimuth(this.pos, this.heading, road)) < 45 && Math.hypot(road[0] - this.pos[0], road[1] - this.pos[1]) < 60)
      this.urgent(recoveryFor(this.o.pkg.arrival?.recovery ?? [], "road"));
  }
  /** Which way the door is, in whole turns of 15 degrees (the autowalk and tests). */
  doorTurn(): number { return wrap180(Math.atan2(this.door[0] - this.pos[0], this.door[1] - this.pos[1]) * 180 / Math.PI - this.heading); }

  repeat(): void { if (this.lastLine) this.say(this.lastLine, 2); }
  private setBeacon(on: boolean): void { this.beacon = on; if (on) this.audioOut?.beaconOn(); else this.audioOut?.beaconOff(); }
  toggleBeacon(): void { this.setBeacon(!this.beacon); }

  private updateCount(): void {
    const left = Math.max(0, Math.round(Math.hypot(this.door[0] - this.pos[0], this.door[1] - this.pos[1]) / 0.7));
    const n = this.state === "fly" ? (this.o.pkg.arrival?.steps ?? left) : left;
    this.el.count.textContent = `${n}`;
    this.el.unit.textContent = n === 1 ? "step to the door" : "steps to the door";
  }

  private autoWalk(): void {
    this.autoTimer = setInterval(() => {
      if (this.state !== "walk") return;
      const d = this.doorTurn();
      if (Math.abs(d) > 8) this.heading = (this.heading + d + 360) % 360, this.turn(0); else this.step();
      this.step();
    }, 380);
  }

  // ---- through the door --------------------------------------------------------------------------------------
  private async arrive(): Promise<void> {
    if (this.state !== "walk") return;
    this.state = "door"; this.root.dataset.state = "door";
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.setBeacon(false);
    this.speak(this.lineByWhen.door, true);
    this.speak(this.lineByWhen.inside);
    const to = doorPose(this.door, this.heading);
    if (this.reduced) { this.cur = to; this.applyPose(to); this.sc.setShellLevel(0.33); (["door", "building", "ground"] as RevealKey[]).forEach(k => this.sc.reveal(k, false, true)); this.afterMove(); }
    else { this.camFrom = this.cur; this.camTo = to; this.camT = 0; this.camDur = DOOR_S; this.sc.setShellLevel(0.33);
      // through the doorway: the canopy and pins go as the camera passes under them, then the aerial photo
      this.later(500, () => this.sc.reveal("ground", false));
      this.later(1000, () => { this.sc.reveal("door", false); this.sc.reveal("building", false); }); }
    void this.audioOut?.handoff();
  }
  private timers: ReturnType<typeof setTimeout>[] = [];
  private later(ms: number, f: () => void): void { this.timers.push(setTimeout(f, ms)); }

  private async afterMove(): Promise<void> {
    if (this.state !== "door") return;
    await this.idle(9000);
    if (this.disposed) return;
    this.state = "inside"; this.root.dataset.state = "inside";
    this.resolveDone();
    this.o.onInside?.();
    this.sc.setShellLevel(0);
    setTimeout(() => this.dispose(), this.reduced ? 0 : 1100);
  }

  // ---- input and chrome ---------------------------------------------------------------------------------------
  private onKey(e: KeyboardEvent): void {
    if (this.state === "inside" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const k = e.key;
    if (this.state === "fly") { e.preventDefault(); e.stopPropagation(); this.skip(); return; }
    const handled = k === "ArrowUp" || k === "ArrowLeft" || k === "ArrowRight" || k === " " || k === "b" || k === "B";
    if (!handled) return;
    e.preventDefault(); e.stopPropagation();
    if (k === "ArrowUp") this.step();
    else if (k === "ArrowLeft") this.turn(-TURN_DEG);
    else if (k === "ArrowRight") this.turn(TURN_DEG);
    else if (k === " ") this.repeat();
    else this.toggleBeacon();
  }

  private chrome(): HTMLElement {
    const d = document.createElement("div");
    d.className = "outdoor__chrome";
    d.innerHTML = `
      <div class="outdoor__card outdoor__count" aria-hidden="true"><span class="outdoor__steps">0</span><span class="outdoor__unit">steps to the door</span></div>
      <button type="button" class="btn btn--secondary btn--small outdoor__skip">Skip the flight</button>
      <div class="outdoor__caption" aria-hidden="true"></div>
      <div class="outdoor__hint" hidden aria-hidden="true">
        <kbd>Up</kbd> step <kbd>Left</kbd><kbd>Right</kbd> turn <kbd>Space</kbd> repeat <kbd>B</kbd> door sound
      </div>
      <div class="outdoor__pad" role="group" aria-label="Walk controls">
        <button type="button" class="btn btn--secondary btn--small" data-act="left">Turn left</button>
        <button type="button" class="btn btn--primary btn--small" data-act="step">Step</button>
        <button type="button" class="btn btn--secondary btn--small" data-act="right">Turn right</button>
      </div>`;
    d.querySelector(".outdoor__skip")!.addEventListener("click", () => this.skip());
    d.querySelectorAll<HTMLButtonElement>("[data-act]").forEach(b => b.addEventListener("click", () => {
      const a = b.dataset.act; if (a === "step") this.step(); else this.turn(a === "left" ? -TURN_DEG : TURN_DEG);
    }));
    return d;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.timers.forEach(clearTimeout);
    window.removeEventListener("keydown", this.keyH, true);
    this.ro?.disconnect();
    this.audioOut?.stop();
    this.sc.dispose(); this.renderer.dispose();
    this.root.remove();
  }
}
