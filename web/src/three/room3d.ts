// The 3D room for sighted watchers (decorative; aria-hidden). Everything is drawn from package.json:
// walls from grid cells, rooms with scanned=false hatched, landmarks, the route. Plan->three in mapping.ts.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CANE_M } from "../config";
import type { BuildingPackage, Landmark, Vec2 } from "../types";
import { decodeCells } from "../world";
import { floorPlanPlacement, headingDir3, headingToYaw, roomMask, toThree, wallRects, type FloorPlanMeta, type Rect } from "./mapping";

export type ViewMode = "behind" | "top" | "orbit";
export const WALL_H = 2.4;

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

function labelSprite(text: string, ink: string): THREE.Sprite {
  const c = document.createElement("canvas"); c.width = 512; c.height = 96;
  const g = c.getContext("2d")!;
  g.font = "600 40px system-ui, -apple-system, sans-serif";
  const w = Math.min(500, g.measureText(text).width + 36);
  g.fillStyle = "#FFFFFF"; g.fillRect(256 - w / 2, 12, w, 64);
  g.strokeStyle = ink; g.lineWidth = 3; g.strokeRect(256 - w / 2, 12, w, 64);
  g.fillStyle = ink; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 256, 46, 470);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(3.2, 0.6, 1); s.renderOrder = 10;
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
  private pins = new Map<string, THREE.Group>();
  private hi: THREE.Mesh;
  private taps: { m: THREE.Mesh; t0: number }[] = [];
  private lookAt = new THREE.Vector3();
  private orbitA = 0.6;
  private raf = 0;
  private last = 0;
  private ro: ResizeObserver | null = null;
  private disposables: { dispose(): void }[] = [];
  private center: THREE.Vector3;
  private accent: string; private mark: string; private ink: string;

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
    this.lights();
    this.floor(opts.floorPlan ?? null);
    this.walls();
    this.landmarks();
    this.routeRibbon();

    // walker: yellow capsule, small ink nose for the heading
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 6, 16), new THREE.MeshStandardMaterial({ color: this.mark, roughness: 0.6 }));
    cap.position.y = 0.65; cap.castShadow = true;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 16), new THREE.MeshStandardMaterial({ color: this.ink }));
    nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0.95, -0.28);
    this.walker.add(cap, nose);
    this.scene.add(this.walker);
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
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false }));
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
    add(boxes(R([1]), WALL_H), new THREE.MeshStandardMaterial({ color: 0xe5e5ea, roughness: 0.95 }));
    add(boxes(R([2]), 1.0), new THREE.MeshStandardMaterial({ color: 0xaeaeb2, roughness: 0.9 }));
    add(boxes(R([3]), 0.45), new THREE.MeshStandardMaterial({ color: 0xd2d2d7, roughness: 1 }));
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
    this.pins.forEach(p => { this.scene.remove(p); });
    this.pins.clear();
    const destId = this.pkg.routes[0]?.to;
    for (const l of this.pkg.landmarks) this.addPin(l, l.id === destId);
  }

  private addPin(l: Landmark, dest: boolean): void {
    const grp = new THREE.Group();
    const col = dest ? this.ink : "#6E6E73";
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, dest ? 1.9 : 1.5, 8), new THREE.MeshBasicMaterial({ color: col }));
    stem.position.y = dest ? 0.95 : 0.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(dest ? 0.2 : 0.14, 20, 14), new THREE.MeshBasicMaterial({ color: col }));
    head.position.y = dest ? 1.95 : 1.55;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    const label = labelSprite((l.confidence < 0.6 ? "possibly " : "") + l.label + (dest ? " (destination)" : ""), this.ink);
    label.position.y = dest ? 2.45 : 2.0;
    grp.add(stem, head, ring, label);
    const [x, , z] = toThree(l.pos);
    grp.position.set(x, 0, z);
    this.scene.add(grp);
    this.pins.set(l.id, grp);
  }

  /** After an edit in the objects list: redraw pins from the given landmarks. */
  setLandmarks(list: Landmark[]): void {
    this.pins.forEach(p => this.scene.remove(p));
    this.pins.clear();
    const destId = this.pkg.routes[0]?.to;
    list.forEach(l => this.addPin(l, l.id === destId));
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
    this.pos = pos; this.heading = headingDeg; this.caneDeg = caneDeg;
    const [x, , z] = toThree(pos);
    this.walker.position.set(x, 0, z);
    this.walker.rotation.y = headingToYaw(headingDeg);
    const d = headingDir3(headingDeg + caneDeg);
    this.cane.scale.z = CANE_M;
    this.cane.position.set(x + d[0] * CANE_M / 2, 0.8, z + d[2] * CANE_M / 2);
    this.cane.rotation.y = headingToYaw(headingDeg + caneDeg);
  }

  tap(at: Vec2, now = performance.now()): void {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.16, 32), new THREE.MeshBasicMaterial({ color: this.ink, transparent: true, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    const [x, , z] = toThree(at); m.position.set(x, 0.06, z);
    this.scene.add(m); this.taps.push({ m, t0: now });
  }

  highlight(id: string | null): void {
    const p = id ? this.pins.get(id) : null;
    this.hi.visible = !!p;
    if (p) this.hi.position.set(p.position.x, 0.03, p.position.z);
    this.pins.forEach((g, k) => g.scale.setScalar(k === id ? 1.35 : 1));
  }

  setView(v: ViewMode): void { this.view = v; if (this.reduced) this.snapCamera(); }

  private target(): { cam: THREE.Vector3; look: THREE.Vector3 } {
    const [x, , z] = toThree(this.pos);
    const d = headingDir3(this.heading);
    const w = new THREE.Vector3(x, 0, z);
    if (this.view === "top") return { cam: new THREE.Vector3(x, 22, z + 0.01), look: w };
    if (this.view === "orbit") return { cam: new THREE.Vector3(x + Math.sin(this.orbitA) * 8, 5.5, z + Math.cos(this.orbitA) * 8), look: w.clone().setY(0.8) };
    return { cam: new THREE.Vector3(x - d[0] * 3.4, 6.2, z - d[2] * 3.4), look: new THREE.Vector3(x + d[0] * 2.2, 0.3, z + d[2] * 2.2) };
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
