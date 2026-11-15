// The Top 8 interactions (review/agent5_interaction.md section 3): around me, bump, place picker and beacon, where am I,
// room entry, ahead cone, approach callouts and doorway cues. Every one speaks through Speech and plays through
// AudioEngine, and publishes one `cue` on the event bus so the 3D view and the observer never need their own logic.
import { pulse, PULSE } from "../audio/haptics";
import { clockHour } from "../clock";
import type { Cue } from "../events";
import type { Door, Room, Vec2 } from "../types";
import { dist, type World } from "../world";
import { clearLine, findPath, nextPick, targetOrder } from "./beacon";
import { BumpGate, bumpOf } from "./bump";
import type { Explore } from "./explore";
import { ApproachTracker, crossesDoor, echoSeconds, RoomTracker, roomLine, roomSize } from "./rooms";
import { aheadSummary, azOf, itemsOf, los, nearestPlaces, sameRoom, stepsWords, SWEEP_GAP_MS, type Item } from "./sweep";

type Pub = Omit<Cue, "v" | "t" | "ts">;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const mid = (d: Door): Vec2 => [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
export const KEYS_LINE = "Arrows walk and turn. Tab: choose a place. Enter: go there. B: beacon on or off, in Rehearse a hint. X: back to Explore. Q: around me. E: ahead. W: where am I. Space: repeat. V: photo view. P: pause. K: these keys again.";

/** Explore's arrival radius for a beacon target, metres from the walker to the place's position. */
export const TARGET_ARRIVE_M = 1.0;
/** Beacon path hysteresis: re-plan only when more than REPLAN_M off the planned path; move on from a corner within CORNER_M. */
export const REPLAN_M = 1.0, CORNER_M = 0.5;
/** A straight walkable line with LINE_MARGIN_M to spare either side, so a step does not lose it again (no flicker). */
const LINE_MARGIN_M = 0.1;
function wideClear(world: World, p: Vec2, q: Vec2): boolean {
  const d = dist(p, q) || 1, nx = -(q[1] - p[1]) / d * LINE_MARGIN_M, ny = (q[0] - p[0]) / d * LINE_MARGIN_M;
  return clearLine(world, p, q) && clearLine(world, [p[0] + nx, p[1] + ny], q) && clearLine(world, [p[0] - nx, p[1] - ny], q);
}
/** Just outside the beacon's 0.3 m mute: the aim always moves on by here. */
export const CORNER_MIN_M = 0.35;
/** Distance from p to the segment a-b. */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}
export const arrivedLine = (name: string): string => `You have reached the ${name.toLowerCase()}.`;

export class Interact {
  readonly items: Item[];
  picked: string | null = null;
  private token = 0;
  private sweeping = false;
  private gate = new BumpGate();
  private rooms = new RoomTracker();
  private callouts = new ApproachTracker(2.5, 4, 4000);
  private doorways = new ApproachTracker(3, 5, 0);
  /** The last landmark said by name, for the S key outside a rehearsal. */
  lastItem: Item | null = null;

  constructor(private ex: Explore) { this.items = itemsOf(ex.world.pkg); }

  private get world(): World { return this.ex.world; }
  private get t() { return this.ex.traveller; }
  private get speech() { return this.ex.speech; }
  private get audio() { return this.ex.audio; }
  private pub(c: Pub): void { this.speech.bus.publish(c); }
  private clock(at: Vec2): number { return clockHour(azOf(this.t.pos, this.t.heading, at)); }
  private byId(id: string | null): Item | null { return this.items.find(i => i.id === id) ?? null; }
  private nameOpts(i: Item) { return { at: i.at }; }

  /** A key or a new request cancels a running sweep, ahead or where. */
  cancel(): void { this.token++; if (this.sweeping) { this.sweeping = false; this.pub({ kind: "sweep_item", id: "end" }); } }
  stop(): void { this.cancel(); }
  reset(): void { this.arrived = false; this.callouts.reset(); this.doorways.reset(); this.rooms = new RoomTracker(); }

  private logHint(): void { if (this.ex.rehearse) this.ex.logHint(); }

  // ---- Q: around me: the nearest 4 places, "<name>, <clock> o'clock, <N> steps." each from where it is ----------------
  async around(_detail: boolean): Promise<void> {
    if (this.ex.locked) return;
    this.cancel();
    const tk = ++this.token;
    this.sweeping = true;
    this.logHint();
    const list = nearestPlaces(this.places(), this.t.pos, 4);
    this.pub({ kind: "sweep_item", id: "start", deg: 0 });
    this.audio.cue("sweepStart", { bus: "cue", pri: 1 });
    if (!list.length) { this.sweeping = false; this.pub({ kind: "sweep_item", id: "end" }); this.speech.say("No places in this building.", 2); return; }
    for (const it of list) {
      if (tk !== this.token) return;
      this.lastItem = it;
      this.pub({ kind: "sweep_item", id: it.id, at: it.at, label: it.name, deg: Math.round(azOf(this.t.pos, this.t.heading, it.at)) });
      await this.speech.sayAsync(this.placeLine(it), 1, { at: it.at });   // the spoken name only, never a confidence word
      if (tk !== this.token) return;
      await sleep(SWEEP_GAP_MS);
    }
    if (tk === this.token) { this.sweeping = false; this.pub({ kind: "sweep_item", id: "end" }); }
  }

  // ---- E: ahead of me, one line: "Clear 4 metres. Wall at 11 o'clock, 2 metres. Doorway at 1 o'clock, 3 metres." -------
  ahead(): void {
    if (this.ex.locked) return;
    this.cancel();
    this.logHint();
    const a = aheadSummary(this.world, this.t.pos, this.t.heading, this.items, this.world.pkg.doors ?? []);
    this.pub({ kind: "cone", deg: 60, hit_m: Math.round(a.clear_m * 10) / 10 });
    this.speech.say(a.text, 2);
  }

  // ---- Tab: place picker (landmarks and the destination) -------------------------------------------------------
  /** The ids Tab offers first, from the package: every route destination in route order, then the entrances. */
  get leadIds(): string[] {
    const pkg = this.world.pkg, ids = new Set(pkg.landmarks.map(l => l.id));
    const out: string[] = [];
    for (const r of pkg.routes) if (ids.has(r.to) && !out.includes(r.to)) out.push(r.to);
    for (const e of pkg.entrances) if (!out.includes(e.id)) out.push(e.id);
    return out;
  }

  /** The places Tab cycles: this building's landmarks and entrances; the route destinations, then the entrances, first,
   *  then the rest by distance. */
  places(): Item[] {
    const pkg = this.world.pkg;
    const ids = new Set([...pkg.landmarks.map(l => l.id), ...pkg.entrances.map(e => e.id)]);
    return targetOrder(this.items.filter(i => ids.has(i.id)), this.t.pos, this.leadIds);
  }

  /** "<name>, <clock> o'clock, <N> steps." in one line, said from the place. */
  placeLine(it: Item): string { return `${it.name}, ${this.clock(it.at)} o'clock, ${stepsWords(dist(this.t.pos, it.at))}.`; }

  pick(dir: 1 | -1): void {
    if (this.ex.locked) return;
    this.cancel();
    const it = nextPick(this.places(), this.picked ?? this.cursor, dir);
    if (!it) { this.speech.say("No places in this building.", 2); return; }
    this.picked = it.id; this.lastItem = it; this.cursor = null;
    this.pub({ kind: "pick", id: it.id, at: it.at, label: it.name });
    this.speech.say(this.placeLine(it), 1, this.nameOpts(it));
  }

  /** Phone "Places": this place becomes the beacon target (Explore); in Rehearse it is only named, never a target. */
  go(id: string): void {
    const it = this.byId(id); if (!it) return;
    this.cancel();
    if (this.ex.rehearse) { this.lastItem = it; this.speech.say(this.placeLine(it), 1, this.nameOpts(it)); return; }
    this.setTarget(it);
  }

  // ---- the continuous beacon's target ----------------------------------------------------------------------------
  /** Chosen with Tab then Enter; null means the route destination. */
  target: Item | null = null;
  /** True once the current target is reached (Explore): the beacon stops until the next target is set. */
  arrived = false;
  /** After an arrival: Tab continues from the place reached, so the next leg's target is one press away. */
  private cursor: string | null = null;
  get destItem(): Item | null { return this.byId(this.ex.destination?.id ?? null); }
  /** What the beacon is aimed at (the chosen target, else the route destination), reached or not. */
  get aimed(): Item | null { return this.target ?? this.destItem; }
  /** What the beacon points at now: nothing once the target is reached. */
  get beaconTarget(): Item | null { return this.arrived ? null : this.aimed; }
  /** The planned route to the beacon target: [start, ...corners], the last corner the target itself; `i` the corner aimed at. */
  private aimCache: { id: string; path: Vec2[]; i: number } | null = null;
  /** Where the Explore beacon sounds from: a corner of the walkable path to the target (so following it leads round walls,
   *  furniture and through doors), else the target itself. Null once reached. The path is planned once per target and kept
   *  (no flipping between routes); it is re-planned only when the walker strays more than REPLAN_M from it; when the corner
   *  aimed at is out of sight, only the way to that corner is re-planned. The aim moves on to the next corner once
   *  within CORNER_M of it or once the next one is in a straight walkable line (always the NEXT corner, never a further one), so only the target itself is ever close enough to mute. A corner that
   *  turns out of sight after that move gets its way round on the next frame. */
  beaconAim(): Vec2 | null {
    const tg = this.beaconTarget;
    if (!tg) return null;
    const p = this.t.pos;
    let c = this.aimCache;
    if (!c || c.id !== tg.id || segDist(p, c.path[c.i - 1], c.path[c.i]) > REPLAN_M) {
      const path = findPath(this.world, p, tg.at);
      if (!path || !path.length) { this.aimCache = null; return tg.at; }
      path[path.length - 1] = tg.at;
      c = this.aimCache = { id: tg.id, path: [[p[0], p[1]], ...path], i: 1 };
    } else if (dist(p, c.path[c.i]) > CORNER_M && !clearLine(this.world, p, c.path[c.i])) {
      // the corner aimed at is out of sight (a corner cut short): a way to that same corner, then the same route on
      const sub = findPath(this.world, p, c.path[c.i]);
      if (sub) c = this.aimCache = { id: tg.id, path: [[p[0], p[1]], ...sub.slice(0, -1), c.path[c.i], ...c.path.slice(c.i + 1)], i: 1 };
    }
    // passing a corner: on to the next one once it is in a straight walkable line (step by step, never past one out of line)
    // (the stretch now walked starts here, so the >REPLAN_M check measures from the walker, not a skipped corner: no flip)
    while (c.i < c.path.length - 1 && wideClear(this.world, p, c.path[c.i + 1])) { c.path[c.i] = [p[0], p[1]]; c.i++; }
    // within CORNER_M of a corner: on to the next once it is in sight (else no sooner than just outside the mute radius, so
    // cutting a corner short never loops between a way round and the corner)
    while (c.i < c.path.length - 1 && dist(p, c.path[c.i]) <= CORNER_M
      && (clearLine(this.world, p, c.path[c.i + 1]) || dist(p, c.path[c.i]) <= CORNER_MIN_M)) c.i++;
    return c.path[c.i];
  }
  /** The persistent on screen line. */
  targetText(): string {
    const b = this.aimed;
    if (!b) return "Target: none";
    return this.arrived ? `Reached: ${b.name}` : `Target: ${b.name}${this.target ? "" : " (destination)"}`;
  }
  showTarget(): void {
    const el = globalThis.document?.getElementById("target-line");
    if (el) el.textContent = this.targetText();
  }

  setTarget(it: Item): void {
    this.target = it.id === this.ex.destination?.id ? null : it;
    this.picked = null; this.cursor = null; this.arrived = false; this.lastItem = it;
    this.pub({ kind: "pick", id: it.id, at: it.at, label: it.name, ids: ["go"] });
    this.showTarget();
    this.speech.say(`Target set, ${it.name}.`, 2, { at: it.at });
  }

  /** Enter with a place highlighted (Tab): it becomes the beacon target. */
  startBeacon(): void {
    if (this.ex.rehearse) return;   // Rehearse: Enter is the hint, never a target
    const it = this.byId(this.picked) ?? this.places()[0];
    if (!it) { this.speech.say("No places in this building.", 2); return; }
    this.setTarget(it);
  }

  /** True when Escape has something to clear: a chosen target, a highlighted place or a running sweep. */
  get busy(): boolean { return !!this.target || !!this.picked || this.sweeping; }
  get beaconOn(): boolean { return !!this.target; }

  /** Back to Explore: no chosen target, nothing highlighted, nothing reached; nothing said. */
  escapeQuiet(): void { this.cancel(); this.picked = null; this.cursor = null; this.target = null; this.arrived = false; this.showTarget(); }

  /** Esc: back to the route destination, forget the highlighted place, cut a sweep. */
  escape(): void {
    const had = !!this.target;
    this.cancel();
    this.picked = null;
    this.target = null; this.arrived = false;
    this.showTarget();
    this.pub({ kind: "pick", id: "none" });
    if (!had) return;
    this.pub({ kind: "arrive", id: "off" });
    const d = this.destItem;
    this.speech.say(d ? `Target cleared. Heading to ${d.name}.` : "Target cleared.", 2);
  }

  /** Explore: within TARGET_ARRIVE_M of the target (the chosen one, else the destination): the chime and "You have reached
   *  the <name>." once, and the beacon stops. It stays reached until the next target is set (Tab, Enter) or Escape.
   *  Rehearse has its own arrival. */
  private checkArrive(): void {
    if (this.ex.rehearse || this.arrived) return;
    const tg = this.aimed;
    if (!tg || dist(this.t.pos, tg.at) > TARGET_ARRIVE_M) return;
    this.arrived = true;
    this.cursor = tg.id;
    this.ex.cont?.silenceBeacon();
    this.audio.cue("chime", { bus: "cue", pri: 1 });
    this.pub({ kind: "arrive", at: tg.at, id: tg.id, label: tg.name });
    this.showTarget();
    this.speech.say(arrivedLine(tg.name), 2, { at: tg.at });
  }

  // ---- bump -----------------------------------------------------------------------------------------------------
  bump(dir: 1 | -1): boolean {
    const t = this.t;
    const b = bumpOf(this.world, t.pos, dir > 0 ? t.heading : t.heading + 180, this.items, this.world.pkg.doors);
    if (!b || !this.audio.recipes) return false;
    this.audio.cue("thud", { bus: "safety", at: b.at, pri: 3, announce: false });
    this.pub({ kind: "bump", at: b.at, label: b.label });
    pulse(PULSE.bump);
    if (this.gate.shouldName(b.key, this.ex.clock())) {
      setTimeout(() => {                         // the name starts as the thud ends, from the same point
        void (async () => {
          await this.speech.sayAsync(b.label, b.pri, { at: b.at });
          if (b.may_move) await this.speech.sayAsync("may move", 1);
        })();
      }, 250);
    }
    return true;
  }

  // ---- W: where am I --------------------------------------------------------------------------------------------
  where(rehearse?: { i: number; n: number; steps: number; wall: string }): void {
    this.cancel();
    const tk = ++this.token;
    const t = this.t, room = this.world.roomAt(t.pos);
    const parts: string[] = [room ? roomLine(room) : "Between rooms."];
    const ids: string[] = [];
    const facing = this.items.map(i => ({ i, az: azOf(t.pos, t.heading, i.at), d: dist(t.pos, i.at) }))
      .filter(x => Math.abs(x.az) <= 20 && x.d <= 10 && x.i.kind !== "entrance").sort((a, b) => Math.abs(a.az) - Math.abs(b.az))[0];
    if (facing) { parts.push(`Facing the ${facing.i.name.toLowerCase()}, ${stepsWords(facing.d)}.`); ids.push(facing.i.id); }
    else {
      const hit = this.world.raycast(t.pos, t.heading, 10);
      parts.push(hit ? `Facing ${hit.code === 4 ? "glass" : hit.code === 5 ? "stairs" : "a wall"}, ${stepsWords(hit.dist)}.` : "Facing open space.");
    }
    const door = this.nearestDoor();
    if (door) {
      const other = (door.d.rooms as string[]).map(id => this.world.pkg.rooms.find(r => r.id === id)).find(r => r && r.id !== room?.id && r.label);
      parts.push(`Nearest door at ${this.clock(door.at)} o'clock, ${stepsWords(door.dist)}${other ? `, to the ${other.label.toLowerCase()}` : ""}.`);
      ids.push(door.d.id);
    }
    if (rehearse) parts.push(`Stretch ${rehearse.i + 1} of ${rehearse.n}: ${rehearse.steps} steps${rehearse.wall !== "none" ? `, wall on your ${rehearse.wall}` : ""}.`);
    this.pub({ kind: "where", ids, at: door?.at });
    this.logHint();
    void (async () => {
      for (const p of parts) { if (tk !== this.token) return; await this.speech.sayAsync(p, 2); }
      if (tk === this.token && door) this.speech.say("door", 1, { at: door.at });  // anchor the sentence in space
    })();
  }

  nearestDoor(): { d: Door; at: Vec2; dist: number } | null {
    let best: { d: Door; at: Vec2; dist: number } | null = null;
    for (const d of this.world.pkg.doors ?? []) { const m = mid(d), x = dist(this.t.pos, m); if (!best || x < best.dist) best = { d, at: m, dist: x }; }
    return best;
  }

  // ---- automatic: room entry, doorways, callouts -----------------------------------------------------------------------
  /** Call after every step (announce true) with the position before and after it. */
  onStep(prev: Vec2, room: Room | null, announce: boolean): void {
    const cur = this.t.pos, doors = this.world.pkg.doors ?? [];
    const crossed = doors.find(d => crossesDoor(prev, cur, d)) ?? null;
    if (crossed) this.jambs(crossed);
    const entered = this.rooms.step(room, !!crossed);
    if (!announce) return;
    this.checkArrive();
    const busy = this.speech.busyPri;
    if (entered) {
      this.pub({ kind: "room", id: entered.id, label: entered.label, deg: echoSeconds(entered) * 10 });
      void (async () => {
        await this.speech.sayAsync(`You are entering the ${entered.label.toLowerCase()}.`, 1);
        const [l, w] = roomSize(entered.polygon);                // "About 8 by 6 metres." (the room's name was just said)
        if (l > 0) await this.speech.sayAsync(`About ${Math.round(l)} by ${Math.round(w)} metres.`, 1);
      })();
      return;
    }
    if (busy !== null && busy >= 2) return;                      // an instruction is being said: drop the priority 1 cues
    const now = this.ex.clock();
    // doorway cue
    let doorCand: { d: Door; az: number; dd: number } | null = null;
    for (const d of doors) {
      const m = mid(d), dd = dist(cur, m), az = azOf(cur, this.t.heading, m);
      const near = this.doorways.check(d.id, dd, now, false);
      if (near && Math.abs(az) <= 70 && (!doorCand || dd < doorCand.dd)) doorCand = { d, az, dd };
    }
    if (doorCand) { this.sayDoorway(doorCand.d, doorCand.dd, room); this.doorways.check(doorCand.d.id, doorCand.dd, now, true); return; }
    if (this.ex.rehearse || this.sweeping) return;
    let best: { i: Item; d: number } | null = null;
    for (const i of this.items) {
      if (!i.fixed || i.kind === "entrance" || i.kind === "door" || i.kind === "glass_door") continue;
      const d = dist(cur, i.at);
      if (this.callouts.check(i.id, d, now, false) && (sameRoom(this.world, cur, i.at) || los(this.world, cur, i.at)) && (!best || d < best.d)) best = { i, d };
    }
    if (best) {
      this.callouts.check(best.i.id, best.d, now, true);
      this.lastItem = best.i;
      this.pub({ kind: "callout", id: best.i.id, at: best.i.at, label: best.i.name });
      this.speech.say(best.i.name, 1, this.nameOpts(best.i));       // its name, from where it is
      pulse(PULSE.landmark);
    }
  }

  private jambs(d: Door): void {
    const glass = this.world.cellAt(mid(d)) === 4;
    const name = glass ? "jambGlass" : "jamb";
    this.audio.cue(name, { bus: "safety", at: d.a, pri: 2, label: "door" });
    setTimeout(() => this.audio.cue(name, { bus: "safety", at: d.b, pri: 2, label: "door" }), 60);
    this.pub({ kind: "door", at: mid(d), ids: [d.id], deg: Math.round(dist(d.a, d.b) * 100) });
  }

  private sayDoorway(d: Door, dd: number, room: Room | null): void {
    const wide = dist(d.a, d.b) > 1.2;
    const into = (d.rooms as string[]).map(id => this.world.pkg.rooms.find(r => r.id === id)).find(r => r && r.id !== room?.id && r.label);
    this.jambs(d);
    this.speech.say(`${wide ? "Wide doorway" : "Doorway"} at ${this.clock(mid(d))} o'clock, ${stepsWords(dd)}${into ? `, into the ${into.label.toLowerCase()}` : ""}.`, 1);
  }
}
