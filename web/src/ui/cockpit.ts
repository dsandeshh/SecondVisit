// The sighted watcher's view of the rehearsal: 3D room, objects list, mini floor plan, live instruction strip,
// agent and data panel (UI_DESIGN 4.2a). Read only on the traveller's state; it never changes audio or keys.
import { STEP_M } from "../config";
import { ringLabel, type Cue } from "../events";
import { shownName } from "../names";
import type { Explore, ExploreHooks } from "../modes/explore";
import type { Session } from "../modes/session";
import { Room3D, type SceneMode, type ViewMode } from "../three/room3d";
import { calmFloor, clearBackdrop, type FloorPlanMeta } from "../three/mapping";
import type { BuildingPackage, Landmark, LandmarkKind, Prov, Vec2 } from "../types";
import { bearing, dist } from "../world";
import { chip, chipKind, describeProv, layerCounts, METER_ORDER, renderLayerMeter, withPossibly } from "./prov";

export type FloorPlan = { meta: FloorPlanMeta; url: string; img: CanvasImageSource } | { missing: string };

/** The plan image on a transparent backdrop, scaled to at most 2048 px wide (shared by the 3D floor and the mini plan). */
function cleaned(img: HTMLImageElement): { canvas: HTMLCanvasElement; url: string } {
  const k = Math.min(1, 2048 / img.width);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, c.width, c.height);
  try { const d = g.getImageData(0, 0, c.width, c.height); clearBackdrop(d.data); g.putImageData(d, 0, 0); } catch { /* keep the raw image */ }
  let url = c.toDataURL("image/png");
  try { // the 3D floor is the calm version of the same plan (the mini plan keeps the original)
    const c2 = document.createElement("canvas"); c2.width = c.width; c2.height = c.height;
    const g2 = c2.getContext("2d")!; g2.drawImage(c, 0, 0);
    const d = g2.getImageData(0, 0, c2.width, c2.height); calmFloor(d.data); g2.putImageData(d, 0, 0);
    url = c2.toDataURL("image/png");
  } catch { /* keep the plain plan */ }
  return { canvas: c, url };
}

export async function loadFloorPlan(sid: string, f: typeof fetch = fetch): Promise<FloorPlan> {
  try {
    const r = await f(`/buildings/${sid}/floorplan.json`);
    const ct = r.headers?.get?.("content-type") ?? "";
    if (!r.ok || /text\/html/.test(ct)) return { missing: "floorplan.json missing" };
    const j = await r.json();
    const res = Number(j?.resolution), ox = Number(j?.origin?.x), oy = Number(j?.origin?.y);
    const w = Number(j?.width), h = Number(j?.height);
    if (!(res > 0) || !Number.isFinite(ox) || !Number.isFinite(oy)) return { missing: "bad floorplan.json" };
    const rawUrl = `/buildings/${sid}/floorplan.jpg`;
    const img = await new Promise<HTMLImageElement>((ok, no) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("floorplan.jpg missing")); i.src = rawUrl;
    });
    const cl = cleaned(img);
    return { meta: { origin: { x: ox, y: oy }, resolution: res, width: w > 0 ? w : img.width, height: h > 0 ? h : img.height }, url: cl.url, img: cl.canvas };
  } catch (e) { return { missing: e instanceof Error ? e.message : "floor plan missing" }; }
}

const KINDS: LandmarkKind[] = ["desk", "elevator", "stairs", "door", "glass_door", "seating", "restroom", "sign", "pillar", "water", "other"];

/** Steps still to walk: the rest of this stretch plus every later stretch (all from the package). */
export function stepsToGo(pkg: BuildingPackage, seg: number, pos: Vec2): number {
  const segs = pkg.routes[0]?.segments ?? [];
  if (!segs[seg]) return 0;
  const here = Math.ceil(dist(pos, segs[seg].end) / STEP_M - 1e-9);
  return Math.min(segs[seg].steps, Math.max(0, here)) + segs.slice(seg + 1).reduce((a, s) => a + s.steps, 0);
}

type Edit = { op: "rename"; id: string; label: string } | { op: "remove"; id: string } | { op: "add"; landmark: Landmark };

export class Cockpit {
  room: Room3D | null = null;
  landmarks: Landmark[];
  private fp: FloorPlan | null = null;
  private sel: string | null = null;
  private pointByRun: Record<number, number> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private planCtx: CanvasRenderingContext2D | null = null;
  private ringOff: (() => void) | null = null;
  private cueOff: (() => void) | null = null;
  private beacon: { bp: Vec2; target: Vec2 } | null = null;
  private coneTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private doc: Document, readonly pkg: BuildingPackage, private ex: Explore, private session: Session,
    hooks: ExploreHooks, private fetcher: typeof fetch = fetch) {
    this.landmarks = pkg.landmarks.map(l => ({ ...l }));
    this.topBar();
    this.record();
    this.views();
    void this.start(hooks);
  }

  private $<T extends HTMLElement = HTMLElement>(id: string): T { return this.doc.getElementById(id) as T; }

  private async start(hooks: ExploreHooks): Promise<void> {
    this.fp = await loadFloorPlan(this.pkg.id, this.fetcher);
    const note = this.$("plan-note");
    if ("missing" in this.fp) { note.hidden = false; note.textContent = `Floor plan not available (${this.fp.missing}).`; }
    try {
      this.room = new Room3D(this.$("room3d"), this.pkg, { floorPlan: "meta" in this.fp ? { meta: this.fp.meta, url: this.fp.url } : null });
      const prev = hooks.onTap;
      hooks.onTap = (at, code) => { prev?.(at, code); this.room?.tap(at); };
      this.room.setLandmarks(this.landmarks);
      void this.initScene(this.room);
      // The sound ring: the same cues the headphones get (one event bus), each flashed where it comes from.
      this.ringOff = this.ex.speech.bus.subscribe(c => {
        const label = ringLabel(c);
        if (label === null || !this.room) return;
        const bus = c.bus ?? "voice", css = (n: string, f: string) => getComputedStyle(this.doc.documentElement).getPropertyValue(n).trim() || f;
        const color = bus === "safety" ? css("--d-obstacle", "#C45A00") : bus === "ambient" ? "#6E6E73" : css("--d-route", "#2160A8");
        this.room.flash(c.at ?? null, label, color);
      });
      this.cueOff = this.ex.speech.bus.subscribe(c => this.onCue(c));
    } catch {
      const n = this.$("room3d-note"); n.hidden = false; n.textContent = "3D view not available in this browser.";
    }
    await this.loadEdits();
    this.objects();
    this.addForm();
    this.agentButton();
    const cv = this.$<HTMLCanvasElement>("miniplan");
    this.planCtx = cv.getContext("2d");
    this.timer = setInterval(() => this.tick(), 50);
  }

  destroy(): void { if (this.timer) clearInterval(this.timer); this.ringOff?.(); this.cueOff?.(); this.room?.dispose(); }

  /** Real scan is the default scene; the Plan view takes over (with a visible note) when the GLB is missing or slow. */
  private async initScene(room: Room3D): Promise<void> {
    const btns = Array.from(this.doc.querySelectorAll<HTMLButtonElement>("[data-scene]"));
    const press = (m: SceneMode) => btns.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.scene === m)));
    const note = this.$("room3d-note");
    btns.forEach(b => b.addEventListener("click", () => {
      const m = b.dataset.scene as SceneMode;
      if (m === "scan" && !room.hasScan) return;
      room.setScene(m); press(m);
    }));
    const scanBtn = btns.find(b => b.dataset.scene === "scan");
    note.hidden = false; note.textContent = "Loading the real scan.";
    const why = await room.loadScan(`/buildings/${this.pkg.id}/scan.glb`);
    if (this.room !== room) return;
    if (why) {
      room.setScene("plan"); press("plan");
      note.textContent = `Real scan not available (${why}). Showing the built plan.`;
    } else {
      room.setScene("scan"); press("scan"); note.hidden = true; note.textContent = "";
      if (scanBtn) scanBtn.disabled = false;
    }
  }

  /** Each interaction's cue draws its own picture (agent5 section 5 visual grammar): blue = what the system points at, orange = bumps. */
  private onCue(c: Cue): void {
    const room = this.room, t = this.ex.traveller;
    if (!room) return;
    const css = (n: string, f: string) => getComputedStyle(this.doc.documentElement).getPropertyValue(n).trim() || f;
    const select = (id: string | null) => { if (this.sel !== id) { this.sel = id; room.highlight(id); this.objects(); } };
    switch (c.kind) {
      case "sweep_item":
        if (c.id === "end") { room.wedge(null); room.focus([]); }
        else if (c.id === "start") room.wedge(t.heading);
        else if (c.at) { room.wedge(bearing(t.pos, c.at)); room.focus([c.id!]); select(c.id!); }
        break;
      case "cone": {
        room.cone(true, c.hit_m ?? 12, Math.round((c.hit_m ?? 12) / STEP_M)); room.focus(c.ids ?? []);
        if (this.coneTimer) clearTimeout(this.coneTimer);
        this.coneTimer = setTimeout(() => { room.cone(false); room.focus([]); }, 6000);
        break;
      }
      case "pick":
        if (c.id === "none" || !c.id) { select(null); this.beacon = null; room.setPath(null); room.wedge(null); }
        else { select(c.id); if (c.ids?.includes("go") && c.at) this.beacon = { bp: c.at, target: c.at }; }
        break;
      case "pulse": if (c.at) { room.ripple(c.at); this.beacon = { bp: c.at, target: this.itemAt(c.id) ?? c.at }; } break;
      case "waypoint": if (c.at) room.ripple(c.at, css("--c-ink", "#1D1D1F"), 500); break;
      case "arrive": this.beacon = null; room.setPath(null); room.wedge(null); if (c.at) room.ripple(c.at, css("--c-ink", "#1D1D1F"), 1200); break;
      case "bump": if (c.at) room.ripple(c.at, css("--d-obstacle", "#C45A00"), 300); break;
      case "where": room.clockFace(true); room.focus(c.ids ?? []); setTimeout(() => room.focus([]), 5000); break;
      case "room": room.tintRoom(c.id ?? null); break;
      case "door": if (c.at) { const d = this.pkg.doors.find(x => x.id === c.ids?.[0]); if (d) room.glowDoor(d.a, d.b, `${(c.deg! / 100).toFixed(1)} m MP`, false); } break;
      case "callout": if (c.id) { room.focus([c.id]); setTimeout(() => room.focus([]), 1500); } break;
    }
  }
  private itemAt(id?: string): Vec2 | null { const l = this.landmarks.find(x => x.id === id); return l ? l.pos : null; }

  // ---- top bar ----------------------------------------------------------------------------
  private topBar(): void {
    const p = this.pkg, a = p.arrival, ga = p.frames?.geo_anchor;
    const where = a ? `${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}` : ga ? `${ga.lat.toFixed(4)}, ${ga.lon.toFixed(4)}` : "";
    const meta = this.$("place-meta");
    meta.replaceChildren();
    const addr = /^.* of [^,]+, (.+?)\.?$/.exec(a?.driver_message ?? "")?.[1]?.replace(/, US$/, "").replace(/, (TX|[A-Z]{2}), (\d{5})/, ", $1 $2");
    [addr, where && `${where}`, p.map_date && `Map ${p.map_date}`].filter(Boolean).forEach(t => {
      const sp = this.doc.createElement("span"); sp.textContent = t as string; meta.append(sp);
    });
    const host = this.$("tags");
    const c = layerCounts(p.prov);
    host.replaceChildren();
    for (const k of METER_ORDER) {
      if (!c[k]) continue;
      const s = this.doc.createElement("span");
      s.className = `chip chip--${k.toLowerCase()}`;
      s.textContent = k;
      s.setAttribute("aria-label", `${k}: ${c[k]} facts`);
      host.append(s);
    }
  }

  /** Top view: the stage takes the building's aspect (no empty bands above and below); other views keep the full height. */
  private fitStage(): void {
    const cockpit = this.doc.querySelector<HTMLElement>(".cockpit"), stage = this.$("stage");
    if (!cockpit || !this.room) return;
    cockpit.style.removeProperty("--cockpit-h");
    if (this.room.view !== "top") return;
    const full = stage.clientHeight, w = stage.clientWidth;
    if (!w || !full) return;
    const h = Math.round(Math.min(full, Math.max(300, w / this.room.topAspect + 8)));
    cockpit.style.setProperty("--cockpit-h", `${h}px`);
  }

  private views(): void {
    this.doc.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(b => b.addEventListener("click", () => {
      this.room?.setView(b.dataset.view as ViewMode);
      this.fitStage();
      this.doc.querySelectorAll("[data-view]").forEach(o => o.setAttribute("aria-pressed", String(o === b)));
    }));
    // [ ] and \ are free keys; the stage keeps every other binding
    this.doc.addEventListener("keydown", e => {
      const v = ({ "[": "behind", "]": "top", "\\": "orbit" } as Record<string, ViewMode>)[e.key];
      if (!v || e.ctrlKey || e.metaKey || e.altKey) return;
      this.doc.querySelector<HTMLButtonElement>(`[data-view="${v}"]`)?.click();
    });
  }

  // ---- objects list ---------------------------------------------------------------------------
  private async loadEdits(): Promise<void> {
    try {
      const r = await this.fetcher(`/api/overrides/${this.pkg.id}`);
      if (!r.ok) return;
      const o = await r.json();
      this.apply(o);
    } catch { /* offline: the package's own landmarks stand */ }
  }

  private apply(o: { extra_landmarks?: Landmark[]; deleted_landmark_ids?: string[]; label_overrides?: Record<string, string> }): void {
    const by = new Map(this.pkg.landmarks.map(l => [l.id, { ...l }]));
    (o.extra_landmarks ?? []).forEach(l => by.set(l.id, { ...l }));
    (o.deleted_landmark_ids ?? []).forEach(id => by.delete(id));
    Object.entries(o.label_overrides ?? {}).forEach(([id, label]) => { const l = by.get(id); if (l) l.label = label; });
    this.landmarks = [...by.values()];
    this.room?.setLandmarks(this.landmarks);
  }

  private async save(e: Edit): Promise<void> {
    const note = this.$("obj-note");
    try {
      const r = await this.fetcher(`/api/overrides/${this.pkg.id}/landmarks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(e) });
      if (!r.ok) { note.textContent = `Not saved: ${(await r.json().catch(() => ({})))?.detail ?? r.status}`; return; }
      this.apply(await r.json());
      note.textContent = "Saved to overrides.json. Rebuild the package to re-plan the route.";
    } catch { note.textContent = "Not saved: the engine API is not running."; }
    this.objects();
  }

  private objects(): void {
    const body = this.doc.querySelector("#objects tbody")!;
    body.replaceChildren();
    const destId = this.pkg.routes[0]?.to;
    const count = this.doc.getElementById("obj-count");
    if (count) count.textContent = `${this.landmarks.length}`;
    for (const l of this.landmarks) {
      const tr = this.doc.createElement("tr");
      if (l.id === this.sel) tr.className = "is-selected";
      const th = this.doc.createElement("th"); th.scope = "row";
      const name = this.doc.createElement("button");
      name.type = "button"; name.className = "linkbtn";
      name.textContent = shownName(l) + (l.id === destId ? " (destination)" : "");
      name.title = l.label; name.setAttribute("aria-pressed", String(l.id === this.sel));
      name.addEventListener("click", () => { this.sel = this.sel === l.id ? null : l.id; this.room?.highlight(this.sel); this.objects(); });
      const sub = this.doc.createElement("span"); sub.className = "objects__sub";
      sub.textContent = `${l.kind.replace("_", " ")} \u00b7 ${l.fixed ? "fixed" : "movable"} \u00b7 ${l.confidence.toFixed(2)}`;
      th.append(name, sub);
      const src = this.doc.createElement("td");
      const p = this.pkg.prov?.[`landmark:${l.id}`];
      if (p) { const c = chip(this.doc, `landmark:${l.id}`, p, this.pkg.prov); src.append(c.button, c.details); }
      else src.textContent = "none";
      const act = this.doc.createElement("td"); act.className = "objects__act";
      const ren = this.doc.createElement("button"); ren.type = "button"; ren.className = "btn btn--secondary btn--small";
      ren.textContent = "Rename"; ren.setAttribute("aria-label", `Rename ${l.label}`);
      ren.addEventListener("click", () => {
        const v = globalThis.prompt?.(`New name for ${l.label}`, l.label)?.trim();
        if (v) void this.save({ op: "rename", id: l.id, label: v });
      });
      const del = this.doc.createElement("button"); del.type = "button"; del.className = "btn btn--secondary btn--small";
      del.textContent = "Remove"; del.setAttribute("aria-label", `Remove ${l.label}`);
      del.addEventListener("click", () => void this.save({ op: "remove", id: l.id }));
      act.append(ren, del);
      tr.append(th, src, act);
      body.append(tr);
      if (l.id === this.sel) tr.scrollIntoView?.({ block: "nearest" });
    }
    if (!this.landmarks.length) { const tr = this.doc.createElement("tr"); const td = this.doc.createElement("td"); td.colSpan = 3; td.textContent = "No landmarks in this package."; tr.append(td); body.append(tr); }
  }

  private addForm(): void {
    const form = this.$<HTMLFormElement>("obj-add");
    const sel = form.elements.namedItem("kind") as HTMLSelectElement;
    KINDS.forEach(k => { const o = this.doc.createElement("option"); o.value = k; o.textContent = k.replace("_", " "); sel.append(o); });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const label = (form.elements.namedItem("label") as HTMLInputElement).value.trim();
      if (!label) return;
      const pos = this.ex.traveller.pos;
      const id = `hand-${Date.now().toString(36)}`;
      void this.save({ op: "add", landmark: { id, kind: sel.value as LandmarkKind, label, pos: [pos[0], pos[1]], confidence: 1, fixed: false } });
      form.reset();
    });
  }

  // ---- agent and data ----------------------------------------------------------------------------
  private record(): void {
    const ul = this.$("record-facts");
    ul.replaceChildren();
    const cs = Object.entries(this.pkg.prov ?? {}).filter(([, p]) => chipKind(p) === "CS");
    if (!cs.length) { const li = this.doc.createElement("li"); li.textContent = "No CoStar facts in this package."; ul.append(li); }
    for (const [k, p] of cs) {
      const li = this.doc.createElement("li");
      li.append(`${k}: ${p.ref} `);
      const c = chip(this.doc, k, p, this.pkg.prov); li.append(c.button, c.details);
      ul.append(li);
    }
    renderLayerMeter(this.$("layer-meter"), this.pkg);
  }

  private agentButton(): void {
    const b = this.$<HTMLButtonElement>("agent-run");
    b.addEventListener("click", () => void this.runAgent());
  }

  private async runAgent(): Promise<void> {
    const log = this.$("agent-log"), note = this.$("agent-note"), b = this.$<HTMLButtonElement>("agent-run");
    log.replaceChildren(); b.disabled = true; note.textContent = "Asking the agent. This is a live call.";
    const line = (t: string) => { const li = this.doc.createElement("li"); li.textContent = t; log.append(li); };
    try {
      const r = await this.fetcher("/api/agent", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `Plan the visitor route for ${this.pkg.name}`, building_id: this.pkg.id, route_id: this.pkg.routes[0]?.id }) });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const rd = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!chunk.startsWith("data:")) continue;
          const ev = JSON.parse(chunk.slice(5));
          const t = traceLine(ev);
          if (t) line(t);
          if (ev.type === "start") note.textContent = ev.mode === "scripted" || ev.mode === "replay" ? `${ev.mode}` : "live";
        }
      }
      note.textContent = "Done.";
    } catch (e) {
      note.textContent = `Agent not available (${e instanceof Error ? e.message : "offline"}). The rehearsal does not need it.`;
    }
    b.disabled = false;
  }

  // ---- per tick ----------------------------------------------------------------------------------------
  private set(id: string, t: string): void { const e = this.$(id); if (e.textContent !== t) e.textContent = t; }

  private tick(): void {
    const t = this.ex.traveller, s = this.session;
    this.room?.setPose(t.pos, t.heading, t.caneDeg);
    const route = this.pkg.routes[0];
    const n = route?.segments.length ?? 0;
    const seg = s.phase === "rehearse" && s.run ? s.run.current : 0;
    this.room?.setSegment(seg);
    if (this.beacon && this.room) {            // the dashed path and the wedge follow the walker; the wedge goes solid within 15 degrees
      this.room.setPath([t.pos, this.beacon.bp, this.beacon.target]);
      const az = Math.abs(((bearing(t.pos, this.beacon.bp) - t.heading + 540) % 360) - 180);
      this.room.wedge(bearing(t.pos, this.beacon.bp), az <= 15);
    }
    if (route) {
      if (s.phase === "rehearse" && s.run) {
        this.set("strip-text", "");
        this.set("strip-seg", `Stretch ${seg + 1} of ${n}`);
        this.set("strip-steps", `About ${stepsToGo(this.pkg, seg, t.pos)} steps to the destination`);
        const total = route.segments.reduce((a, x) => a + x.steps, 0) || 1;
        const pct = Math.round(100 * (1 - stepsToGo(this.pkg, seg, t.pos) / total));
        (this.$("strip-fill") as HTMLElement).style.width = `${Math.max(0, Math.min(100, pct))}%`;
      } else if (s.phase === "explore") {
        this.set("strip-text", "Press Start rehearsal when you are ready.");
        this.set("strip-seg", `Route: ${n} stretches`);
        this.set("strip-steps", `${route.segments.reduce((a, x) => a + x.steps, 0)} steps in all`);
        (this.$("strip-fill") as HTMLElement).style.width = "0%";
      } else {
        this.set("strip-seg", s.phase === "summary" ? "Run complete" : `Route: ${n} stretches`);
        this.set("strip-text", this.$("say-polite").textContent || "");
        (this.$("strip-fill") as HTMLElement).style.width = s.phase === "summary" ? "100%" : (this.$("strip-fill") as HTMLElement).style.width;
        this.set("strip-steps", "");
      }
    } else { this.set("strip-text", "No route in this building."); }
    if (s.run?.log.point.length) this.pointByRun[s.runNo] = Math.round(s.run.log.point[s.run.log.point.length - 1].error_deg);
    this.sessionFacts();
    this.drawPlan();
  }

  private sessionFacts(): void {
    const s = this.session, dl = this.$("session-dl");
    const rows: [string, string][] = [];
    const q = s.run?.log.quiz ?? [];
    rows.push(["Quiz", q.length ? q.map(x => (x.correct ? "correct" : "not this one")).join(", ") : "not taken yet"]);
    const pe = Object.entries(this.pointByRun).map(([r, d]) => `run ${r}: ${d} degrees off`);
    rows.push(["Pointing", pe.length ? pe.join(", ") : "not done yet"]);
    rows.push(["Coach", s.coach ? `${s.coach.line} (${s.coach.source === "agent" ? "coach" : "scripted"})` : "after run 1"]);
    const key = JSON.stringify(rows);
    if (dl.dataset.k === key) return;
    dl.dataset.k = key; dl.replaceChildren();
    rows.forEach(([k, v]) => { const dt = this.doc.createElement("dt"), dd = this.doc.createElement("dd"); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); });
  }

  private drawPlan(): void {
    const cv = this.$<HTMLCanvasElement>("miniplan"), ctx = this.planCtx;
    if (!ctx || !cv.clientWidth) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.doc.documentElement);
    const ink = css.getPropertyValue("--c-ink").trim() || "#1D1D1F", accent = css.getPropertyValue("--c-accent").trim() || "#0066CC";
    const mark = css.getPropertyValue("--c-mark").trim() || "#FFC629", paper = css.getPropertyValue("--c-surface").trim() || "#fff";
    ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H);
    const g = this.pkg.grid, mw = g.width * g.res, mh = g.height * g.res;
    const sc = Math.min(W / mw, H / mh) * 0.98, ox = (W - mw * sc) / 2, oy = (H + mh * sc) / 2;
    const X = (x: number) => ox + (x - g.origin[0]) * sc, Y = (y: number) => oy - (y - g.origin[1]) * sc;
    if (this.fp && "meta" in this.fp) {
      const m = this.fp.meta, w = m.width / m.resolution, h = m.height / m.resolution;
      ctx.save(); ctx.globalAlpha = 0.85;
      ctx.drawImage(this.fp.img, X(m.origin.x), Y(m.origin.y + h), w * sc, h * sc); ctx.restore();
    }
    const r = this.pkg.routes[0];
    if (r) {
      r.segments.forEach((sg, i) => {
        ctx.beginPath(); ctx.moveTo(X(sg.start[0]), Y(sg.start[1])); ctx.lineTo(X(sg.end[0]), Y(sg.end[1]));
        ctx.strokeStyle = accent; ctx.lineWidth = i === (this.session.run?.current ?? -1) ? 5 : 3;
        ctx.globalAlpha = i === (this.session.run?.current ?? -1) ? 1 : 0.55; ctx.stroke(); ctx.globalAlpha = 1;
      });
    }
    for (const l of this.landmarks) {
      ctx.fillStyle = l.id === this.pkg.routes[0]?.to ? ink : "#6E6E73";
      ctx.beginPath(); ctx.arc(X(l.pos[0]), Y(l.pos[1]), l.id === this.sel ? 7 : 4, 0, Math.PI * 2); ctx.fill();
    }
    const t = this.ex.traveller, a = t.heading * Math.PI / 180;
    const px = X(t.pos[0]), py = Y(t.pos[1]);
    ctx.strokeStyle = ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.sin(a) * 16, py - Math.cos(a) * 16); ctx.stroke();
    ctx.fillStyle = mark; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

export function traceLine(ev: { type: string; [k: string]: unknown }): string | null {
  switch (ev.type) {
    case "delegate": return `${ev.to}: ${String(ev.task ?? "").slice(0, 90)}`;
    case "tool_call": return `${ev.agent} calls ${ev.tool}`;
    case "tool_result": return `${ev.tool}: ${ev.ok === false ? "failed" : "done"}`;
    case "question": return `Question: ${ev.question}`;
    case "fallback": return `Scripted fallback: ${ev.reason}`;
    case "final": return "Final answer ready";
    case "error": return `Error: ${ev.message}`;
    default: return null;
  }
}
