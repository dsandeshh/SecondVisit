// The outdoor scene (agent6 4.1.3), drawn from package.arrival in the plan frame. Line rules follow UI_DESIGN:
// solid = measured, dashed = assumed, dotted = AI, yellow = HAND. Every object carries its chip (VX, HAND, CALC, MP,
// assumed, simulated) on a label that keeps its size on screen.
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { STEP_M } from "../../config";
import { roadLine } from "../../audio/outdoor";
import { wktLonLat, geoToPlan } from "../../geo/frame";
import type { BuildingPackage, Vec2 } from "../../types";
import { headingToYaw, toThree } from "../mapping";
import type { RevealKey } from "./camera";

export type Chip = "VX" | "HAND" | "CALC" | "MP" | "assumed" | "simulated";
export const ASSUMED_HEIGHT_M = 4.5;
export const CANOPY_Z = 3.0;

const css = (name: string, fallback: string): string => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
};

/** Douglas Peucker, so the 667 point scan outline draws as clean walls. */
export function simplify(pts: Vec2[], tol = 0.12): Vec2[] {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  let best = 0, bi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L;
    if (d > best) { best = d; bi = i; }
  }
  if (best <= tol) return [a, b];
  return [...simplify(pts.slice(0, bi + 1), tol).slice(0, -1), ...simplify(pts.slice(bi), tol)];
}

/** A closed outline simplified without losing the closing corner. */
export const simplifyRing = (ring: Vec2[], tol = 0.12): Vec2[] => {
  const r = simplify([...ring, ring[0]], tol); r.pop(); return r;
};

function chipColors(c: Chip): { fill: string; ink: string } {
  if (c === "HAND") return { fill: "#FFC629", ink: "#0F1C2A" };
  if (c === "assumed" || c === "simulated") return { fill: "#FFFFFF", ink: "#6E6E73" };
  return { fill: "#FFFFFF", ink: "#1D1D1F" };
}

/** Label with its chips, drawn once to a canvas. Constant screen size (sizeAttenuation false). */
export function labelSprite(text: string, chips: Chip[], px = 0.034): THREE.Sprite {
  const S = 2, H = 40 * S, pad = 14 * S, gap = 8 * S;
  const c = document.createElement("canvas"), g = c.getContext("2d")!;
  g.font = `600 ${17 * S}px system-ui, -apple-system, sans-serif`;
  const tw = g.measureText(text).width;
  g.font = `700 ${12 * S}px system-ui, -apple-system, sans-serif`;
  const cw = chips.map(k => g.measureText(k).width + 12 * S);
  const W = Math.ceil(pad * 2 + tw + cw.reduce((a, b) => a + b + gap, 0));
  c.width = W; c.height = H;
  const r = 8 * S;
  g.fillStyle = "#FFFFFF"; g.strokeStyle = "#1D1D1F"; g.lineWidth = 1.5 * S;
  g.beginPath(); g.roundRect(1, 1, W - 2, H - 2, r); g.fill(); g.stroke();
  g.fillStyle = "#1D1D1F"; g.textBaseline = "middle"; g.font = `600 ${17 * S}px system-ui, -apple-system, sans-serif`;
  g.fillText(text, pad, H / 2 + 1);
  let x = pad + tw + gap;
  chips.forEach((k, i) => {
    const { fill, ink } = chipColors(k), w = cw[i];
    g.fillStyle = fill; g.strokeStyle = ink; g.lineWidth = 1.5 * S;
    if (k === "assumed" || k === "simulated") g.setLineDash([4 * S, 3 * S]);
    g.beginPath(); g.roundRect(x, H / 2 - 11 * S, w, 22 * S, 3 * S); g.fill(); g.stroke(); g.setLineDash([]);
    g.fillStyle = ink; g.font = `700 ${12 * S}px system-ui, -apple-system, sans-serif`; g.fillText(k, x + 6 * S, H / 2 + 1);
    x += w + gap;
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(px * W / H, px, 1); s.renderOrder = 20;
  return s;
}

type Fade = { key: RevealKey; objs: THREE.Object3D[]; mats: { m: THREE.Material & { opacity: number }; base: number }[]; a: number; target: number };

export class OutdoorScene {
  readonly scene = new THREE.Scene();
  readonly lineMats: LineMaterial[] = [];
  readonly walker = new THREE.Group();
  readonly curb: Vec2; readonly door: Vec2;
  readonly shellAssumedHeight: boolean;
  private fades = new Map<RevealKey, Fade>();
  private shellLevel = 1;
  private disposables: { dispose(): void }[] = [];
  readonly labels: THREE.Sprite[] = [];
  private ink = css("--c-ink", "#1D1D1F"); private mark = css("--c-mark", "#FFC629");
  private route = css("--d-route", "#2160A8"); private amber = css("--d-obstacle", "#C45A00");

  constructor(readonly pkg: BuildingPackage) {
    const a = pkg.arrival!;
    this.door = (a.door_plan ?? pkg.entrances[0]?.pos ?? [0, 0]) as Vec2;
    this.curb = (a.curb_plan ?? a.dropoff_plan ?? [this.door[0] + 8, this.door[1]]) as Vec2;
    this.shellAssumedHeight = !a.building_height_m;
    this.scene.background = new THREE.Color(css("--c-surface-2", "#F5F5F7"));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd2d2d7, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(-20, 40, 15); this.scene.add(sun);
    this.ground(); this.building(); this.canopy(); this.path(); this.pins(); this.traffic(); this.buildWalker();
  }

  // ---- fade bookkeeping -------------------------------------------------------------------------------------
  private reg(key: RevealKey, obj: THREE.Object3D, start = 0): void {
    this.scene.add(obj);
    let f = this.fades.get(key);
    if (!f) { f = { key, objs: [], mats: [], a: start, target: start }; this.fades.set(key, f); }
    f.objs.push(obj);
    obj.traverse(o => {
      const mat = (o as THREE.Mesh).material as (THREE.Material & { opacity: number }) | undefined;
      for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        m.transparent = true; f!.mats.push({ m, base: m.opacity });
      }
    });
    this.apply(f);
  }
  private apply(f: Fade): void {
    const k = f.key === "building" ? this.shellLevel : 1;
    for (const { m, base } of f.mats) m.opacity = base * f.a * k;
    for (const o of f.objs) o.visible = f.a * k > 0.01;
  }
  /** Show or hide a reveal group; it fades over about a quarter second. */
  reveal(key: RevealKey, on: boolean, instant = false): void {
    const f = this.fades.get(key); if (!f) return;
    f.target = on ? 1 : 0; if (instant) f.a = f.target;
    this.apply(f);
  }
  revealAll(on = true): void { for (const k of this.fades.keys()) this.reveal(k, on, true); }
  /** 1 = the shell as drawn (0.18), 0.33 = 0.06, 0 = gone. */
  setShellLevel(v: number): void { this.shellLevel = v; const f = this.fades.get("building"); if (f) this.apply(f); }
  update(dt: number): void {
    for (const f of this.fades.values()) {
      if (f.a === f.target) continue;
      const d = Math.min(1, dt * 4);
      f.a += (f.target - f.a) * d; if (Math.abs(f.target - f.a) < 0.01) f.a = f.target;
      this.apply(f);
    }
  }
  setResolution(w: number, h: number): void { this.lineMats.forEach(m => m.resolution.set(w, h)); }

  // ---- things -----------------------------------------------------------------------------------------------
  private line(pts: Vec2[], y: number, color: string, width: number, o: { dashed?: boolean; closed?: boolean } = {}): Line2 {
    const flat = (o.closed ? [...pts, pts[0]] : pts).flatMap(p => { const [x, , z] = toThree(p, y); return [x, y, z]; });
    const g = new LineGeometry(); g.setPositions(flat);
    const m = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: width, dashed: !!o.dashed, dashSize: 0.5, gapSize: 0.35, transparent: true, depthTest: false });
    if (o.dashed) m.dashScale = 1;
    const l = new Line2(g, m); l.computeLineDistances(); l.renderOrder = 12;
    this.lineMats.push(m); this.disposables.push(g, m);
    return l;
  }
  private label(text: string, chips: Chip[], at: Vec2, y: number): THREE.Sprite {
    const s = labelSprite(text, chips); const [x, , z] = toThree(at, y); s.position.set(x, y, z);
    this.labels.push(s); return s;
  }

  private ground(): void {
    const o = this.pkg.arrival?.ortho;
    let corners: Vec2[] | null = o?.corners_plan?.length === 4 ? o.corners_plan : null;
    const anchor = this.pkg.frames.geo_anchor;
    if (!corners && o?.wkt && anchor) {
      const ll = wktLonLat(o.wkt); // SW, SE, NE, NW
      if (ll.length === 4) corners = ll.map(p => geoToPlan(anchor, p[1], p[0]));
    }
    if (!corners || !o) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(corners.flatMap(p => { const [x, , z] = toThree(p, -0.02); return [x, -0.02, z]; }), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const tex = new THREE.TextureLoader().load(o.url);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const quad = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    this.disposables.push(g, tex);
    const grp = new THREE.Group(); grp.add(quad);
    const sw = corners[0], se = corners[1];
    grp.add(this.label("Aerial photo", ["VX"], [(sw[0] + se[0]) / 2, (sw[1] + se[1]) / 2], 0.2));
    this.reg("ground", grp);
  }

  private building(): void {
    const ring = this.pkg.arrival?.building_outline_plan;
    if (!ring || ring.length < 3) return;
    const pts = simplifyRing(ring), h = this.pkg.arrival?.building_height_m ?? ASSUMED_HEIGHT_M;
    const pos: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = toThree(pts[i]), b = toThree(pts[(i + 1) % pts.length]);
      pos.push(a[0], 0, a[2], b[0], 0, b[2], b[0], h, b[2], a[0], 0, a[2], b[0], h, b[2], a[0], h, a[2]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const shell = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: this.ink, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    shell.renderOrder = 5;
    const grp = new THREE.Group(); grp.add(shell);
    const edge = this.line(pts, 0.05, this.ink, 2, { closed: true }), top = this.line(pts, h, this.ink, 1.5, { closed: true, dashed: this.shellAssumedHeight });
    grp.add(edge, top);
    this.disposables.push(g);
    const [lx, ly] = [Math.min(...pts.map(p => p[0])), pts.reduce((a, p) => a + p[1], 0) / pts.length];
    grp.add(this.label("Suite from the scan", this.shellAssumedHeight ? ["MP", "assumed"] : ["MP"], [Math.max(...pts.map(p => p[0])) - 1.5, Math.max(...pts.map(p => p[1]))], h + 0.6));
    void lx; void ly;
    this.reg("building", grp);
  }

  private canopy(): void {
    const poly = this.pkg.arrival?.canopy_plan;
    if (!poly || poly.length < 3) return;
    const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.translate(0, CANOPY_Z, 0);
    const slab = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: css("--c-ink-2", "#6E6E73"), transparent: true, opacity: 0.35, depthWrite: false }));
    slab.renderOrder = 6;
    const grp = new THREE.Group(); grp.add(slab, this.line(poly, CANOPY_Z + 0.15, this.ink, 2, { closed: true, dashed: true }));
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    grp.add(this.label("Canopy", ["assumed"], [cx, cy], CANOPY_Z + 0.9));
    this.disposables.push(g);
    this.reg("door", grp);
  }

  private path(): void {
    const a = this.curb, b = this.door, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const grp = new THREE.Group();
    grp.add(this.line([a, b], 0.03, css("--d-route-casing", "#FFFFFF"), 11), this.line([a, b], 0.035, this.route, 6));
    const n = Math.floor(L / STEP_M);
    const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.1, 20), new THREE.MeshBasicMaterial({ color: this.ink, depthTest: false }), n);
    const m = new THREE.Matrix4();
    for (let i = 1; i <= n; i++) {
      const t = (i * STEP_M) / L, [x, , z] = toThree([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      m.compose(new THREE.Vector3(x, 0.05, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1));
      dots.setMatrixAt(i - 1, m);
    }
    dots.renderOrder = 14; grp.add(dots);
    const steps = this.pkg.arrival?.steps ?? Math.round(L / STEP_M);
    grp.add(this.label(`About ${steps} steps`, ["CALC"], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 1.3));
    this.disposables.push(dots.geometry);
    this.reg("path", grp);
  }

  private pins(): void {
    const disc = (p: Vec2, square: boolean) => {
      const geo = square ? new THREE.BoxGeometry(0.9, 0.06, 0.9) : new THREE.CylinderGeometry(0.4, 0.4, 0.06, 32);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: this.mark, depthTest: false }));
      const ring = new THREE.Mesh(square ? new THREE.RingGeometry(0.52, 0.62, 4, 1, Math.PI / 4) : new THREE.RingGeometry(0.4, 0.5, 32),
        new THREE.MeshBasicMaterial({ color: this.ink, side: THREE.DoubleSide, depthTest: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07;
      const g = new THREE.Group(); g.add(mesh, ring); const [x, , z] = toThree(p); g.position.set(x, 0.03, z);
      mesh.renderOrder = ring.renderOrder = 15; this.disposables.push(geo, ring.geometry);
      return g;
    };
    const c = new THREE.Group(); c.add(disc(this.curb, false), this.label("Drop off", ["HAND"], this.curb, 1.7));
    this.reg("curb", c);
    const d = new THREE.Group(); d.add(disc(this.door, true), this.label("Entrance", ["HAND"], this.door, 1.7));
    this.reg("door", d);
  }

  private traffic(): void {
    const cue = this.pkg.arrival?.cues?.find(c => c.kind === "traffic");
    if (!cue?.plan?.length) return;
    const pt = cue.plan[0], line = roadLine(pt, this.curb, 35);
    const grp = new THREE.Group(); grp.add(this.line(line, 0.04, this.amber, 3, { dashed: true }));
    grp.add(this.label("Road, traffic sound", ["simulated"], pt, 1.2));
    this.reg("building", grp);
  }

  private buildWalker(): void {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 6, 16), new THREE.MeshStandardMaterial({ color: this.mark, roughness: 0.6 }));
    body.position.y = 0.67;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 16), new THREE.MeshStandardMaterial({ color: this.ink }));
    nose.rotation.x = -Math.PI / 2; nose.position.set(0, 1.0, -0.3);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 32), new THREE.MeshBasicMaterial({ color: this.ink, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
    this.walker.add(body, nose, ring); this.scene.add(this.walker);
  }

  setWalker(pos: Vec2, heading: number): void {
    const [x, , z] = toThree(pos); this.walker.position.set(x, 0, z); this.walker.rotation.y = headingToYaw(heading);
  }

  dispose(): void {
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) { (x as any).map?.dispose?.(); x.dispose(); }
    });
    this.disposables.forEach(d => d.dispose());
  }
}
