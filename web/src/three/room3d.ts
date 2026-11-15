// The 3D room for sighted watchers (decorative; aria-hidden). Everything is drawn from package.json:
// walls from grid cells, rooms with scanned=false hatched, landmarks, the route. Plan->three in mapping.ts.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CANE_M } from "../config";
import { ringPoint } from "../events";
import { shownName } from "../names";
import type { BuildingPackage, Landmark, Vec2 } from "../types";
import { decodeCells } from "../world";
import { floorPlanPlacement, headingDir3, headingToYaw, roomMask, toThree, wallRects, type FloorPlanMeta, type Rect } from "./mapping";

export type ViewMode = "behind" | "top" | "orbit";
export type SceneMode = "scan" | "plan";
/** The real scan is cut away above this height so the camera sees in from above (metres above the floor). */
export const SCAN_CUT_M = 2.0;
export const WALL_H = 2.4;
export const RING_M = 2.9;

const css = (name: string, fallback: string): string => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
};

function boxes(rects: Rect[], h: number, y0 = 0): THREE.BufferGeometry | null {
  if (!rects.length) return null;
  const gs = rects.map(r => {
    const g = new THREE.BoxGeometry(r.x1 - r.x0, h, r.y1 - r.y0);
    const [x, , z] = toThree([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]);
    g.translate(x, y0 + h / 2, z);
    return g;
  });
  const m = mergeGeometries(gs, false);
  gs.forEach(g => g.dispose());
  return m;
}

function hatchTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#F5F5F7"; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#A1A1A6"; g.lineWidth = 3;
  for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelSprite(text0: string, ink: string): THREE.Sprite {
  const text = text0.length > 34 ? text0.slice(0, 33).trimEnd() + "\u2026" : text0;
  const c = document.createElement("canvas"); c.width = 512; c.height = 96;
  const g = c.getContext("2d")!;
  g.font = "600 40px system-ui, -apple-system, sans-serif";
  const w = Math.min(500, g.measureText(text).width + 36);
  g.fillStyle = "#FFFFFF"; g.fillRect(256 - w / 2, 12, w, 64);
  g.strokeStyle = ink; g.lineWidth = 3; g.strokeRect(256 - w / 2, 12, w, 64);
  g.fillStyle = ink; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 256, 46, 470);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(2.6, 0.49, 1); s.renderOrder = 10;
  return s;
}

export type Room3DOptions = { floorPlan?: { meta: FloorPlanMeta; url: string } | null; reducedMotion?: boolean };

export class Room3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  view: ViewMode = "behind";
  private reduced: boolean;
  private walker = new THREE.Group();
  private cane: THREE.Mesh;
  private pos: Vec2 = [0, 0];
  private heading = 0;
  private caneDeg = 0;
  private routeMeshes: THREE.Mesh[] = [];
  private seg = 0;
  private pins = new Map<string, { grp: THREE.Group; full: THREE.Group; dot: THREE.Mesh; pos: Vec2; dest: boolean }>();
  private selId: string | null = null;
  private bounds: { cx: number; cz: number; w: number; d: number };
  private hi: THREE.Mesh;
  private taps: { m: THREE.Mesh; t0: number }[] = [];
  private ringGrp = new THREE.Group();
  private flashes: { g: THREE.Group; t0: number; life: number; head: boolean }[] = [];
  private wedgeM: THREE.Mesh; private coneM: THREE.Mesh; private rayM: THREE.Mesh; private rayLabel: THREE.Sprite | null = null;
  private pathLine: THREE.Line | null = null;
  private focusIds = new Set<string>();
  private timed: { o: THREE.Object3D; until: number }[] = [];
  private roomTint: THREE.Mesh | null = null;
  private clockGrp: THREE.Group | null = null;
  private lookAt = new THREE.Vector3();
  private orbitA = 0.6;
  private raf = 0;
  private last = 0;
  private ro: ResizeObserver | null = null;
  private disposables: { dispose(): void }[] = [];
  private center: THREE.Vector3;
  private accent: string; private mark: string; private ink: string;
  private planObjs: THREE.Object3D[] = [];
  private scan: THREE.Object3D | null = null;
  sceneMode: SceneMode = "plan";

  constructor(readonly host: HTMLElement, readonly pkg: BuildingPackage, opts: Room3DOptions = {}) {
    this.reduced = opts.reducedMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.accent = css("--c-accent", "#0066CC"); this.mark = css("--c-mark", "#FFC629"); this.ink = css("--c-ink", "#1D1D1F");
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.domElement.className = "room3d__canvas";
    host.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(css("--c-surface-2", "#F5F5F7"));

    const g = pkg.grid;
    this.center = new THREE.Vector3(...toThree([g.origin[0] + g.width * g.res / 2, g.origin[1] + g.height * g.res / 2]));
    this.bounds = this.fit();
    this.lights();
    const n0 = this.scene.children.length;
    this.floor(opts.floorPlan ?? null);
    this.walls();
    this.planObjs = this.scene.children.slice(n0);
    this.landmarks();
    this.routeRibbon();

    // walker: yellow capsule, small ink nose for the heading
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 6, 16), new THREE.MeshStandardMaterial({ color: this.mark, roughness: 0.6 }));
    cap.position.y = 0.65; cap.castShadow = true;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 16), new THREE.MeshStandardMaterial({ color: this.ink }));
    nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0.95, -0.28);
    this.walker.add(cap, nose);
    this.scene.add(this.walker);
    this.buildRing();
    const fan = (deg: number, r: number, color: string, op: number) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40, (90 - deg / 2) * Math.PI / 180, deg * Math.PI / 180),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; const g = new THREE.Group(); g.add(m); g.position.y = 0.05; g.visible = false; this.scene.add(g);
      return g as unknown as THREE.Mesh;
    };
    this.wedgeM = fan(30, 4.2, this.accent, 0.22);
    this.coneM = fan(60, 1, this.accent, 0.16);
    this.rayM = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 1), new THREE.MeshBasicMaterial({ color: this.accent }));
    this.rayM.visible = false; this.scene.add(this.rayM);
    this.cane = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1), new THREE.MeshBasicMaterial({ color: this.ink }));
    this.scene.add(this.cane);
    this.hi = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 40), new THREE.MeshBasicMaterial({ color: this.accent, side: THREE.DoubleSide }));
    this.hi.rotation.x = -Math.PI / 2; this.hi.position.y = 0.03; this.hi.visible = false; this.scene.add(this.hi);

    this.resize();
    if (typeof ResizeObserver !== "undefined") { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host); }
    const e = pkg.entrances[0];
    this.setPose(e?.pos ?? [g.origin[0] + 1, g.origin[1] + 1], e?.heading_deg ?? 0, 0);
    this.snapCamera();
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  /**
   * Load the real Matterport mesh (plan frame: metres, z up, so it takes the same plan->three turn as everything else:
   * x stays, plan z becomes three y, plan y becomes -z). Resolves with a reason string on failure, null on success.
   * Fails (never throws) when the file is missing, is HTML, or does not arrive within `timeoutMs`.
   */
  async loadScan(url: string, timeoutMs = 5000, yUp = false): Promise<string | null> {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ac.signal });
      if (!r.ok) return `HTTP ${r.status}`;
      if (/text\/html/.test(r.headers.get("content-type") ?? "")) return "file missing";
      const buf = await r.arrayBuffer();
      const gltf = await new Promise<{ scene: THREE.Group }>((ok, bad) => new GLTFLoader().parse(buf, "", g => ok(g as { scene: THREE.Group }), bad));
      clearTimeout(timer);
      const grp = new THREE.Group();
      grp.add(gltf.scene);
      if (!yUp) grp.rotation.x = -Math.PI / 2;           // plan (x, y, z up) -> three (x, z, -y)
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), SCAN_CUT_M);   // keeps y <= 2 m
      this.renderer.localClippingEnabled = true;
      gltf.scene.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        m.castShadow = false; m.receiveShadow = false;
        for (const mat of ([] as THREE.Material[]).concat(m.material)) {
          mat.side = THREE.DoubleSide; mat.clippingPlanes = [plane]; mat.needsUpdate = true;
          this.disposables.push(mat);
          (mat as THREE.MeshStandardMaterial).map && this.disposables.push((mat as THREE.MeshStandardMaterial).map!);
        }
        this.disposables.push(m.geometry);
      });
      grp.visible = false; this.scene.add(grp); this.scan = grp;
      return null;
    } catch (e) {
      return ac.signal.aborted ? "took longer than 5 seconds" : (e instanceof Error ? e.message : "failed");
    } finally { clearTimeout(timer); }
  }

  get hasScan(): boolean { return !!this.scan; }

  /** "scan": the real mesh (cut above 2 m) under the pins, route and walker; "plan": the built walls and floor plan. */
  setScene(m: SceneMode): void {
    if (m === "scan" && !this.scan) return;
    this.sceneMode = m;
    const scan = m === "scan";
    if (this.scan) this.scan.visible = scan;
    this.planObjs.forEach(o => { o.visible = !scan; });
    // overlays ignore depth in scan mode so the route ribbon, rings and cane are never buried in the mesh floor
    const over = [...this.routeMeshes, this.hi, this.ringGrp, this.wedgeM, this.coneM, this.rayM, this.cane];
    over.forEach(o => o.traverse(x => { const mm = x as THREE.Mesh; if (!mm.isMesh) return; (mm.material as THREE.Material).depthTest = !scan; mm.renderOrder = scan ? 5 : 0; }));
    this.pins.forEach(p => p.grp.traverse(x => { const mm = x as THREE.Mesh; if (mm.isMesh && !(x as THREE.Sprite).isSprite) { (mm.material as THREE.Material).depthTest = !scan; mm.renderOrder = scan ? 6 : 0; } }));
  }

  /** Bounding box (three coordinates) of the walls, obstacles and the entrance: what the top view must frame. */
  private fit(): { cx: number; cz: number; w: number; d: number } {
    const g = this.pkg.grid, cells = decodeCells(g.cells_b64);
    let c0 = g.width, c1 = -1, r0 = g.height, r1 = -1;
    for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) {
      const v = cells[r * g.width + c];
      if (v === 1 || v === 2 || v === 4) { if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r; }
    }
    const pts: Vec2[] = [];
    if (c1 >= 0) pts.push([g.origin[0] + c0 * g.res, g.origin[1] + r0 * g.res], [g.origin[0] + (c1 + 1) * g.res, g.origin[1] + (r1 + 1) * g.res]);
    else this.pkg.rooms.forEach(r => pts.push(...r.polygon));
    const e = this.pkg.entrances[0]; if (e) pts.push(e.pos);
    if (!pts.length) pts.push(g.origin, [g.origin[0] + g.width * g.res, g.origin[1] + g.height * g.res]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const [cx, , cz] = toThree([(x0 + x1) / 2, (y0 + y1) / 2]);
    return { cx, cz, w: x1 - x0 + 1.2, d: y1 - y0 + 1.2 };
  }

  /** Width over depth of what the top view frames; the page sizes the stage to it so there are no empty bands. */
  get topAspect(): number { return this.bounds.w / this.bounds.d; }

  private lights(): void {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd2d2d7, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(this.center.x + 14, 26, this.center.z + 10);
    sun.target.position.copy(this.center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const e = Math.max(this.pkg.grid.width, this.pkg.grid.height) * this.pkg.grid.res * 0.6;
    Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 80 });
    sun.shadow.bias = -0.0008; sun.shadow.radius = 4;
    this.scene.add(sun, sun.target);
  }

  private floor(fp: Room3DOptions["floorPlan"]): void {
    const g = this.pkg.grid;
    const w = g.width * g.res, h = g.height * g.res;
    const base = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
    base.rotation.x = -Math.PI / 2;
    base.position.set(this.center.x, -0.02, this.center.z); base.receiveShadow = true;
    this.scene.add(base);
    if (!fp) return;
    const p = floorPlanPlacement(fp.meta);
    const tex = new THREE.TextureLoader().load(fp.url);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 1, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    const [x, , z] = toThree([p.cx, p.cy]);
    m.position.set(x, -0.005, z);
    this.scene.add(m);
    this.disposables.push(tex);
  }

  private walls(): void {
    const g = this.pkg.grid;
    const cells = decodeCells(g.cells_b64).slice();
    // cells of walls that sit inside a room nobody scanned: hatched flat patches, not full height blocks
    const BLOCKED = 101;
    for (const r of this.pkg.rooms) {
      if (r.scanned !== false) continue;
      const mask = roomMask(r.polygon, g.width, g.height, g.res, g.origin);
      for (let i = 0; i < cells.length; i++) if (mask[i] && cells[i] === 1) cells[i] = BLOCKED;
    }
    const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, cast = true) => {
      if (!geo) return;
      const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true;
      this.scene.add(m); this.disposables.push(geo, mat);
    };
    const R = (codes: number[]) => wallRects(cells, g.width, g.height, g.res, g.origin, codes);
    add(boxes(R([1]), WALL_H), new THREE.MeshStandardMaterial({ color: 0xc9ccd3, roughness: 0.95 }));
    add(boxes(R([2]), 1.0), new THREE.MeshStandardMaterial({ color: 0x9a9fa8, roughness: 0.9 }));
    add(boxes(R([3]), 0.45), new THREE.MeshStandardMaterial({ color: 0xb9bdc5, roughness: 1 }));
    add(boxes(R([4]), WALL_H), new THREE.MeshStandardMaterial({ color: 0x9cc7f2, transparent: true, opacity: 0.28, roughness: 0.1 }), false);
    add(boxes(R([5]), 0.04), new THREE.MeshStandardMaterial({ color: 0x6e6e73 }), false);
    const hatch = hatchTexture();
    const blocked = R([BLOCKED]);
    if (blocked.length) {
      hatch.repeat.set(1 / 0.6, 1 / 0.6);
      const gs = blocked.map(r => {
        const pg = new THREE.PlaneGeometry(r.x1 - r.x0, r.y1 - r.y0);
        const uv = pg.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, ((r.x0 + uv.getX(i) * (r.x1 - r.x0))) / 0.6, ((r.y0 + uv.getY(i) * (r.y1 - r.y0))) / 0.6);
        pg.rotateX(-Math.PI / 2);
        const [x, , z] = toThree([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]);
        pg.translate(x, 0.01, z);
        return pg;
      });
      const geo = mergeGeometries(gs, false);
      hatch.repeat.set(1, 1);
      add(geo, new THREE.MeshBasicMaterial({ map: hatch }), false);
      gs.forEach(x => x.dispose());
    }
  }

  private landmarks(): void {
    this.pins.forEach(p => { this.scene.remove(p.grp); });
    this.pins.clear();
    const destId = this.pkg.routes[0]?.to;
    for (const l of this.pkg.landmarks) this.addPin(l, l.id === destId);
  }

  private addPin(l: Landmark, dest: boolean): void {
    const grp = new THREE.Group(), full = new THREE.Group();
    const col = dest ? this.ink : "#6E6E73";
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, dest ? 1.9 : 1.5, 8), new THREE.MeshBasicMaterial({ color: col }));
    stem.position.y = dest ? 0.95 : 0.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(dest ? 0.2 : 0.14, 20, 14), new THREE.MeshBasicMaterial({ color: col }));
    head.position.y = dest ? 1.95 : 1.55;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    const label = labelSprite(shownName(l) + (dest ? " (destination)" : ""), this.ink);
    label.position.y = dest ? 2.45 : 2.0;
    full.add(stem, head, ring, label);
    // quiet state: one small dot at head height, no stem, no label
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8 }));
    dot.position.y = 0.9;
    grp.add(full, dot);
    const [x, , z] = toThree(l.pos);
    grp.position.set(x, 0, z);
    this.scene.add(grp);
    this.pins.set(l.id, { grp, full, dot, pos: l.pos, dest });
    this.refreshPins();
  }

  /** Full pin with label only for the destination, the selected object and the nearest one to the walker (within 7 m). */
  private refreshPins(): void {
    const near = [...this.pins.entries()]
      .map(([id, p]) => [id, Math.hypot(p.pos[0] - this.pos[0], p.pos[1] - this.pos[1])] as const)
      .filter(([, d]) => d < 5).sort((a, b) => a[1] - b[1]).slice(0, 1).map(([id]) => id);
    this.pins.forEach((p, id) => {
      const on = p.dest || id === this.selId || near.includes(id) || this.focusIds.has(id);
      p.full.visible = on; p.dot.visible = !on;
      p.full.children[3]?.scale.set(this.view === "top" ? 4.4 : 2.1, this.view === "top" ? 0.83 : 0.4, 1);
    });
  }

  /** After an edit in the objects list: redraw pins from the given landmarks. */
  setLandmarks(list: Landmark[]): void {
    this.pins.forEach(p => this.scene.remove(p.grp));
    this.pins.clear();
    const destId = this.pkg.routes[0]?.to;
    list.forEach(l => this.addPin(l, l.id === destId));
    if (this.sceneMode === "scan") this.setScene("scan");
  }

  private routeRibbon(): void {
    this.routeMeshes.forEach(m => this.scene.remove(m));
    this.routeMeshes = [];
    const r = this.pkg.routes[0];
    if (!r) return;
    for (const s of r.segments) {
      const len = Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1]);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, Math.max(0.05, len)), new THREE.MeshBasicMaterial({ color: this.accent, transparent: true, opacity: 0.4 }));
      const mid: Vec2 = [(s.start[0] + s.end[0]) / 2, (s.start[1] + s.end[1]) / 2];
      const [x, , z] = toThree(mid);
      m.position.set(x, 0.03, z);
      m.rotation.y = headingToYaw(Math.atan2(s.end[0] - s.start[0], s.end[1] - s.start[1]) * 180 / Math.PI);
      this.scene.add(m); this.routeMeshes.push(m);
    }
    this.setSegment(this.seg);
  }

  setSegment(i: number): void {
    this.seg = i;
    this.routeMeshes.forEach((m, k) => {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = k === i ? 1 : 0.4;
      m.position.y = k === i ? 0.05 : 0.03;
    });
  }

  setPose(pos: Vec2, headingDeg: number, caneDeg: number): void {
    const moved = pos[0] !== this.pos[0] || pos[1] !== this.pos[1];
    this.pos = pos; this.heading = headingDeg; this.caneDeg = caneDeg;
    if (moved) this.refreshPins();
    const [x, , z] = toThree(pos);
    this.walker.position.set(x, 0, z);
    this.walker.rotation.y = headingToYaw(headingDeg);
    this.ringGrp.position.set(x, 0, z);
    const d = headingDir3(headingDeg + caneDeg);
    this.cane.scale.z = CANE_M;
    this.cane.position.set(x + d[0] * CANE_M / 2, 0.8, z + d[2] * CANE_M / 2);
    this.cane.rotation.y = headingToYaw(headingDeg + caneDeg);
  }

  /** The sound ring: a faint circle with clock ticks around the walker; sounds flash on it (see flash). */
  private buildRing(): void {
    const m = new THREE.MeshBasicMaterial({ color: this.ink, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(RING_M - 0.025, RING_M + 0.025, 96), m);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.035;
    this.ringGrp.add(ring);
    for (let h = 0; h < 12; h++) {
      const a = h * Math.PI / 6, big = h % 3 === 0;
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, big ? 0.3 : 0.14), m);
      t.position.set(Math.sin(a) * RING_M, 0.035, -Math.cos(a) * RING_M); t.rotation.y = -a;
      this.ringGrp.add(t);
    }
    this.scene.add(this.ringGrp);
  }

  /**
   * One sound on the ring: at its true direction and distance from the walker (up to 7 m), with a short label.
   * `at` null is a sound in the head (a sentence): a ripple around the walker.
   */
  flash(at: Vec2 | null, label: string, color = this.accent, now = performance.now()): void {
    if (this.flashes.length > 8) this.dropFlash(this.flashes[0]);
    const g = new THREE.Group();
    const mat = (c: string) => new THREE.MeshBasicMaterial({ color: c, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    if (at) {
      const p = ringPoint({ pos: this.pos, heading: this.heading }, at, 7).at;
      const [x, , z] = toThree(p), [wx, , wz] = toThree(this.pos);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), mat(color)); dot.rotation.x = -Math.PI / 2; dot.position.set(x, 0.08, z);
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 32), mat(color)); halo.rotation.x = -Math.PI / 2; halo.position.set(x, 0.08, z);
      const len = Math.hypot(x - wx, z - wz);
      const ln = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, len), mat(color));
      ln.position.set((x + wx) / 2, 0.07, (z + wz) / 2); ln.rotation.y = Math.atan2(x - wx, z - wz);
      const sp = labelSprite(label, this.ink); sp.position.set(x, 1.1, z);
      sp.scale.multiplyScalar(this.view === "top" ? 1.7 : 1.05);
      g.add(dot, halo, ln, sp);
    } else {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 40), mat(color));
      r.rotation.x = -Math.PI / 2; r.position.y = 0.08;
      const [wx, , wz] = toThree(this.pos); g.position.set(wx, 0, wz);
      g.add(r);
    }
    this.scene.add(g);
    this.flashes.push({ g, t0: now, life: at ? 1800 : 600, head: !at });
  }

  private dropFlash(f: { g: THREE.Group }): void {
    this.scene.remove(f.g);
    f.g.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mm = m.material as THREE.Material | undefined; (mm as THREE.SpriteMaterial | undefined)?.map?.dispose?.(); mm?.dispose?.(); });
    this.flashes = this.flashes.filter(x => x !== f);
  }

  private placeFan(g: THREE.Object3D, bearingDeg: number): void {
    const [x, , z] = toThree(this.pos);
    g.position.set(x, 0.05, z); g.rotation.y = headingToYaw(bearingDeg);
  }

  /** Around me: a 30 degree wedge at an absolute bearing (null hides it). `solid` when facing the target within 15 degrees. */
  wedge(bearingDeg: number | null, solid = false): void {
    this.wedgeM.visible = bearingDeg !== null;
    if (bearingDeg === null) return;
    this.placeFan(this.wedgeM, bearingDeg);
    this.wedgeM.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (m) m.opacity = solid ? 0.6 : 0.22; });
  }

  /** Pins that are called out (sweep item, cone items) show their label and grow a little. */
  focus(ids: string[]): void {
    this.focusIds = new Set(ids);
    this.pins.forEach((p, id) => p.grp.scale.setScalar(this.focusIds.has(id) || id === this.selId ? 1.3 : 1));
    this.refreshPins();
  }

  /** Ahead of me: a 60 degree cone in front of the walker, and a ray to the first thing hit with its step count. */
  cone(on: boolean, hitM = 0, steps = 0): void {
    this.coneM.visible = this.rayM.visible = on;
    if (this.rayLabel) { this.scene.remove(this.rayLabel); this.rayLabel = null; }
    if (!on) return;
    const r = Math.max(0.5, Math.min(12, hitM || 12));
    this.coneM.scale.set(r, 1, r); this.placeFan(this.coneM, this.heading);
    const d = headingDir3(this.heading), [x, , z] = toThree(this.pos);
    this.rayM.scale.z = r; this.rayM.position.set(x + d[0] * r / 2, 0.08, z + d[2] * r / 2); this.rayM.rotation.y = headingToYaw(this.heading);
    this.rayLabel = labelSprite(`${steps} steps CALC`, this.ink);
    this.rayLabel.position.set(x + d[0] * r, 0.9, z + d[2] * r); this.rayLabel.scale.multiplyScalar(this.view === "top" ? 1.6 : 0.8);
    this.scene.add(this.rayLabel);
  }

  /** An expanding ring at a point: a beacon pulse, a corner tick or a bump. */
  ripple(at: Vec2, color = this.accent, life = 700, now = performance.now()): void {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.24, 32), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; const [x, , z] = toThree(at); m.position.set(x, 0.07, z);
    const g = new THREE.Group(); g.add(m); this.scene.add(g);
    this.flashes.push({ g, t0: now, life, head: false });
    m.scale.setScalar(this.reduced ? 3 : 1);
    (g as any).grow = true;
  }

  /** The dashed path from the walker to the beacon point and on to the target (null clears it). */
  setPath(pts: Vec2[] | null): void {
    if (this.pathLine) { this.scene.remove(this.pathLine); this.pathLine.geometry.dispose(); (this.pathLine.material as THREE.Material).dispose(); this.pathLine = null; }
    if (!pts || pts.length < 2) return;
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...toThree(p, 0.09))));
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: this.accent, dashSize: 0.3, gapSize: 0.2 }));
    l.computeLineDistances(); this.pathLine = l; this.scene.add(l);
  }

  /** Where am I: a clock face of 12 numbers around the walker, aligned to the heading. */
  clockFace(on: boolean, now = performance.now()): void {
    if (this.clockGrp) { this.scene.remove(this.clockGrp); this.clockGrp = null; }
    if (!on) return;
    const g = new THREE.Group(), [wx, , wz] = toThree(this.pos);
    for (let h = 1; h <= 12; h++) {
      const d = headingDir3(this.heading + (h % 12) * 30), sp = labelSprite(String(h), this.ink);
      sp.scale.set(0.5, 0.1, 1); sp.position.set(wx + d[0] * (RING_M + 0.55), 0.5, wz + d[2] * (RING_M + 0.55));
      sp.scale.multiplyScalar(this.view === "top" ? 3 : 2);
      g.add(sp);
    }
    this.scene.add(g); this.clockGrp = g;
    this.timed.push({ o: g, until: now + 5000 });
  }

  /** Room entry: the room's floor tints in; null clears it. */
  tintRoom(id: string | null): void {
    if (this.roomTint) { this.scene.remove(this.roomTint); this.roomTint.geometry.dispose(); this.roomTint = null; }
    const r = this.pkg.rooms.find(x => x.id === id);
    if (!r || r.polygon.length < 3) return;
    const shape = new THREE.Shape(r.polygon.map(p => new THREE.Vector2(p[0], p[1])));
    const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
    this.roomTint = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: this.accent, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    this.roomTint.position.y = 0.012; this.scene.add(this.roomTint);
  }

  /** A door frame glows for a few seconds with its width. */
  glowDoor(a: Vec2, b: Vec2, label: string, glass: boolean, now = performance.now()): void {
    const col = glass ? "#008A7E" : this.ink, g = new THREE.Group();
    for (const p of [a, b]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 10), new THREE.MeshBasicMaterial({ color: col })); const [x, , z] = toThree(p); post.position.set(x, 1.05, z); g.add(post); }
    const [ax, , az] = toThree(a), [bx, , bz] = toThree(b), len = Math.hypot(bx - ax, bz - az);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), new THREE.MeshBasicMaterial({ color: col }));
    beam.position.set((ax + bx) / 2, 2.1, (az + bz) / 2); beam.rotation.y = Math.atan2(bx - ax, bz - az); g.add(beam);
    const sp = labelSprite(label, this.ink); sp.position.set((ax + bx) / 2, 2.5, (az + bz) / 2); sp.scale.multiplyScalar(this.view === "top" ? 1.2 : 0.7); g.add(sp);
    this.scene.add(g); this.timed.push({ o: g, until: now + 3000 });
  }

  tap(at: Vec2, now = performance.now()): void {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.16, 32), new THREE.MeshBasicMaterial({ color: this.ink, transparent: true, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    const [x, , z] = toThree(at); m.position.set(x, 0.06, z);
    this.scene.add(m); this.taps.push({ m, t0: now });
  }

  highlight(id: string | null): void {
    const p = id ? this.pins.get(id) : null;
    this.selId = p ? id : null;
    this.hi.visible = !!p;
    if (p) this.hi.position.set(p.grp.position.x, 0.03, p.grp.position.z);
    this.pins.forEach((q, k) => q.grp.scale.setScalar(k === id ? 1.35 : 1));
    this.refreshPins();
  }

  setView(v: ViewMode): void { this.view = v; this.refreshPins(); if (this.reduced) this.snapCamera(); }

  private target(): { cam: THREE.Vector3; look: THREE.Vector3 } {
    const [x, , z] = toThree(this.pos);
    const d = headingDir3(this.heading);
    const w = new THREE.Vector3(x, 0, z);
    if (this.view === "top") {
      const b = this.bounds, t = Math.tan(this.camera.fov * Math.PI / 360);
      const dist = Math.max(b.d / 2 / t, b.w / 2 / (t * Math.max(0.3, this.camera.aspect))) * 1.03;
      return { cam: new THREE.Vector3(b.cx, dist, b.cz + 0.01), look: new THREE.Vector3(b.cx, 0, b.cz) };
    }
    if (this.view === "orbit") return { cam: new THREE.Vector3(x + Math.sin(this.orbitA) * 8, 5.5, z + Math.cos(this.orbitA) * 8), look: w.clone().setY(0.8) };
    return { cam: new THREE.Vector3(x - d[0] * 4.2, 6.4, z - d[2] * 4.2), look: new THREE.Vector3(x + d[0] * 3, 0.3, z + d[2] * 3) };
  }

  private snapCamera(): void {
    const t = this.target();
    this.camera.position.copy(t.cam); this.lookAt.copy(t.look); this.camera.lookAt(this.lookAt);
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    if (this.view === "orbit" && !this.reduced) this.orbitA += dt * 0.25;
    const t = this.target();
    const k = this.reduced ? 1 : 1 - Math.exp(-dt * 4);
    this.camera.position.lerp(t.cam, k);
    this.lookAt.lerp(t.look, k);
    if (this.view === "top") this.camera.up.set(0, 0, -1); else this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookAt);
    for (const f of [...this.flashes]) {
      const a = (now - f.t0) / f.life;
      if (a >= 1) { this.dropFlash(f); continue; }
      f.g.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.opacity = this.reduced ? 1 - a * a : Math.max(0, 1 - a); });
      if (f.head && !this.reduced) f.g.scale.setScalar(1 + a * 3);
      if ((f.g as any).grow && !this.reduced) f.g.children[0].scale.setScalar(1 + a * 5);
    }
    this.timed = this.timed.filter(t => { if (now < t.until) return true; this.scene.remove(t.o); if (t.o === this.clockGrp) this.clockGrp = null; return false; });
    for (const tp of this.taps) {
      const a = (now - tp.t0) / 700;
      tp.m.scale.setScalar(this.reduced ? 3 : 1 + a * 4);
      (tp.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - a);
    }
    this.taps = this.taps.filter(tp => {
      if ((now - tp.t0) / 700 < 1) return true;
      this.scene.remove(tp.m); tp.m.geometry.dispose(); (tp.m.material as THREE.Material).dispose();
      return false;
    });
    if (this.host.clientWidth > 0) this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(t2 => this.frame(t2));
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.disposables.forEach(d => d.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
