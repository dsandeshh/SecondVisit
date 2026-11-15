// The Top 8 interactions (review/agent5_interaction.md section 3): around me, bump, place picker and beacon, where am I,
// room entry, ahead cone, approach callouts and doorway cues. Every one speaks through Speech and plays through
// AudioEngine, and publishes one `cue` on the event bus so the 3D view and the observer never need their own logic.
import { ARRIVE_M } from "../config";
import { pulse, PULSE } from "../audio/haptics";
import { clockHour } from "../clock";
import type { Cue } from "../events";
import type { Door, Room, Vec2 } from "../types";
import { dist, type World } from "../world";
import { beaconPoint, findPath, nextPick, pulseInterval, pulseKind, targetOrder, WAYPOINT_M } from "./beacon";
import { BumpGate, bumpOf } from "./bump";
import type { Explore } from "./explore";
import { ApproachTracker, crossesDoor, echoSeconds, RoomTracker, roomLine, roomSize } from "./rooms";
import { aheadItems, aheadLine, azOf, itemsOf, los, sameRoom, stepsWords, sweepItems, SWEEP_GAP_MS, type Item } from "./sweep";

type Beacon = { item: Item; path: Vec2[]; timer: ReturnType<typeof setInterval>; next: number };
type Pub = Omit<Cue, "v" | "t" | "ts">;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const mid = (d: Door): Vec2 => [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
export const KEYS_LINE = "Arrows walk and turn. Q: around me. E: ahead. Tab: choose a place. Enter: go there. Escape: stop. W: where am I. Space: repeat. S: source of this line. K: these keys again.";

export class Interact {
  readonly items: Item[];
  picked: string | null = null;
  private token = 0;
  private sweeping = false;
  private beacon: Beacon | null = null;
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
  private nameOpts(i: Item) { return { at: i.at, ...(i.possibly ? { prefix: "possibly" } : {}) }; }

  /** A key or a new request cancels a running sweep, ahead or where. */
  cancel(): void { this.token++; if (this.sweeping) { this.sweeping = false; this.pub({ kind: "sweep_item", id: "end" }); } }
  stop(): void { this.cancel(); this.stopBeacon(false); }
  reset(): void { this.stopBeacon(false); this.callouts.reset(); this.doorways.reset(); this.rooms = new RoomTracker(); }

  private logHint(): void { if (this.ex.rehearse) this.ex.logHint(); }

  // ---- Q: around me ------------------------------------------------------------------------------------------
  async around(detail: boolean): Promise<void> {
    if (this.ex.locked) return;
    this.cancel();
    const tk = ++this.token;
    this.sweeping = true;
    this.logHint();
    const list = sweepItems(this.items, this.t.pos, this.t.heading, this.world);
    this.pub({ kind: "sweep_item", id: "start", deg: 0 });
    this.audio.cue("sweepStart", { bus: "cue", pri: 1 });
    if (!list.length) { this.sweeping = false; this.pub({ kind: "sweep_item", id: "end" }); this.speech.say("Nothing within 8 metres. Try E for ahead.", 2); return; }
    await sleep(150);
    for (const it of list) {
      if (tk !== this.token) return;
      this.lastItem = it;
      this.pub({ kind: "sweep_item", id: it.id, at: it.at, label: it.name, deg: Math.round(it.az) });
      await this.speech.sayAsync(it.name, 1, this.nameOpts(it));
      if (tk !== this.token) return;
      if (detail) { await this.speech.sayAsync(`${this.clock(it.at)} o'clock, ${stepsWords(dist(this.t.pos, it.at))}.`, 1); await sleep(150); }
      await sleep(SWEEP_GAP_MS);
    }
    if (tk === this.token) { this.sweeping = false; this.pub({ kind: "sweep_item", id: "end" }); }
  }

  // ---- E: ahead of me ---------------------------------------------------------------------------------------
  async ahead(): Promise<void> {
    if (this.ex.locked) return;
    this.cancel();
    const tk = ++this.token;
    this.logHint();
    const list = aheadItems(this.items, this.t.pos, this.t.heading, this.world);
    const line = aheadLine(this.world, this.t.pos, this.t.heading, p => {
      const n = this.items.filter(i => dist(i.at, p) <= 1).sort((a, b) => dist(a.at, p) - dist(b.at, p))[0];
      return n ? n.name.charAt(0).toUpperCase() + n.name.slice(1) : null;
    });
    this.pub({ kind: "cone", deg: 60, ids: list.map(i => i.id), hit_m: Math.round(line.hit_m * 10) / 10 });
    for (const it of list) {
      if (tk !== this.token) return;
      this.lastItem = it;
      await this.speech.sayAsync(it.name, 1, this.nameOpts(it));
      if (tk !== this.token) return;
      await this.speech.sayAsync(`${stepsWords(it.d)}.`, 1);
      await sleep(150);
    }
    if (tk === this.token) this.speech.say(line.text, line.pri);
  }

  // ---- Tab: place picker ------------------------------------------------------------------------------------
  pick(dir: 1 | -1): void {
    if (this.ex.locked) return;
    this.cancel();
    const order = targetOrder(this.items, this.t.pos, this.ex.destination?.id);
    const it = nextPick(order, this.picked, dir);
    if (!it) { this.speech.say("No places in this building.", 2); return; }
    this.picked = it.id; this.lastItem = it;
    this.pub({ kind: "pick", id: it.id, at: it.at, label: it.name });
    const tk = ++this.token;
    void (async () => {
      await this.speech.sayAsync(it.name, 1, this.nameOpts(it));
      if (tk !== this.token) return;
      this.speech.say(`${this.clock(it.at)} o'clock, ${stepsWords(dist(this.t.pos, it.at))}.${this.ex.rehearse ? "" : " Press Enter to go there."}`, 1);
    })();
    if (this.beacon) this.startBeacon();         // Tab while going switches the target
  }

  /** Phone "Places": pick this place and, in Explore, start the beacon; in Rehearse only announce it. */
  go(id: string): void {
    const it = this.byId(id); if (!it) return;
    this.cancel(); this.picked = id; this.lastItem = it;
    this.pub({ kind: "pick", id, at: it.at, label: it.name });
    if (this.ex.rehearse) { this.speech.say(`${it.name}, ${this.clock(it.at)} o'clock, ${stepsWords(dist(this.t.pos, it.at))}.`, 1, this.nameOpts(it)); return; }
    this.startBeacon();
  }

  // ---- Enter: beacon (Explore only) ---------------------------------------------------------------------------
  startBeacon(): void {
    if (this.ex.rehearse) { this.ex.hint(); return; }       // Rehearse: Enter is the B hint (three chirps, logged)
    const it = this.byId(this.picked) ?? targetOrder(this.items, this.t.pos, this.ex.destination?.id)[0];
    const ctx = this.audio.ctx;
    if (!it || !ctx) { this.speech.say("No places in this building.", 2); return; }
    this.stopBeacon(false);
    this.picked = it.id;
    const route = this.world.pkg.routes[0];
    let path: Vec2[] | null = null, straight = false;
    if (route && route.to === it.id && route.path.length) path = this.routeAhead(route.path);
    if (!path) path = findPath(this.world, this.t.pos, it.at);
    if (!path) { path = [it.at]; straight = true; }
    if (!path.length) path = [it.at];
    if (straight) this.speech.say("Beacon is straight line, walls may be in the way.", 2);
    const b: Beacon = { item: it, path, next: ctx.currentTime + 0.05, timer: setInterval(() => this.beaconTick(), 25) };
    this.beacon = b;
    this.pub({ kind: "pick", id: it.id, at: it.at, label: it.name, ids: ["go"] });
  }

  /** The rest of the route's path from the point nearest to the walker. */
  private routeAhead(path: Vec2[]): Vec2[] | null {
    let bi = 0, bd = Infinity;
    path.forEach((p, i) => { const d = dist(this.t.pos, p); if (d < bd) { bd = d; bi = i; } });
    if (bd > 3) return null;                        // not on the route: plan from here
    return path.slice(bi + 1);
  }

  get beaconOn(): boolean { return !!this.beacon; }

  private beaconTick(): void {
    const b = this.beacon, ctx = this.audio.ctx;
    if (!b || !ctx || !this.audio.recipes) return;
    const t = this.t, d = dist(t.pos, b.item.at);
    if (d <= ARRIVE_M) { this.arrive(b); return; }
    while (b.path.length > 1 && dist(t.pos, b.path[0]) <= WAYPOINT_M) {
      const c = b.path.shift()!;
      this.audio.cue("cornerTicks", { bus: "cue", at: c, pri: 1, announce: false });
      this.pub({ kind: "waypoint", at: c, id: b.item.id });
    }
    if (this.sweeping) { b.next = Math.max(b.next, ctx.currentTime + 0.05); return; }   // the beacon pauses during a sweep
    while (b.next < ctx.currentTime + 0.1) {
      const bp = beaconPoint(b.path, t.pos, b.item.at, this.world);
      const kind = pulseKind(azOf(t.pos, t.heading, bp));
      this.audio.cue(kind, { bus: "cue", at: bp, pri: 1, rolloff: 0.3, ref: 2, when: b.next, announce: false });
      this.pub({ kind: "pulse", at: bp, id: b.item.id, deg: Math.round(azOf(t.pos, t.heading, bp)) });
      b.next += pulseInterval(d);
    }
  }

  private arrive(b: Beacon): void {
    this.stopBeacon(false);
    this.audio.cue("chime", { bus: "cue", pri: 1 });
    this.pub({ kind: "arrive", at: b.item.at, id: b.item.id, label: b.item.name });
    const place = b.item.name.charAt(0).toLowerCase() + b.item.name.slice(1);
    const near = dist(this.t.pos, b.item.at) < 0.7 ? "within reach" : stepsWords(dist(this.t.pos, b.item.at));
    this.speech.say(`You're at the ${place}, at ${this.clock(b.item.at)} o'clock, ${near}.`, 2, b.item.possibly ? { prefix: "possibly" } : {});
  }

  stopBeacon(say: boolean): void {
    if (!this.beacon) return;
    clearInterval(this.beacon.timer); this.beacon = null;
    this.pub({ kind: "arrive", id: "off" });
    if (say) this.speech.say("Beacon off.", 2);
  }

  /** Esc: stop the beacon (and forget the picked place, so Enter starts the rehearsal again), cut a sweep. */
  escape(): void {
    const was = !!this.beacon;
    this.cancel();
    this.stopBeacon(was);
    this.picked = null;
    if (!was) this.pub({ kind: "pick", id: "none" });
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
