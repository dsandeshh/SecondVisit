// HUD drawn over the Showcase iframe (item 4): route arrows on the floor, the sound ring as a compass at the
// bottom, labels for the destination and the next landmark only, and a small top view map. Captions are NOT
// drawn here (stream 2 owns them; rule 7). Pure canvas, pointer-events none, aria-hidden.
import type { CueBus } from "../events";
import type { BuildingPackage, Landmark, Route, Vec2 } from "../types";
import { bearing, dist, wrap180, type World } from "../world";

export type CamPose = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number }; // pitch (+ up), yaw degrees
  projection?: ArrayLike<number> | null; // 4x4 column major; [0] and [5] give the field of view
};

export type Screen = { x: number; y: number; depth: number };
const R = Math.PI / 180;

/** Pinhole projection of an SDK world point; depth <= 0.1 means behind the camera. */
export function project(pose: CamPose, p: { x: number; y: number; z: number }, W: number, H: number): Screen {
  const y = pose.rotation.y * R, x = pose.rotation.x * R;
  const f = { x: -Math.sin(y) * Math.cos(x), y: Math.sin(x), z: -Math.cos(y) * Math.cos(x) };
  const right = { x: Math.cos(y), y: 0, z: -Math.sin(y) };
  const up = { x: right.y * f.z - right.z * f.y, y: right.z * f.x - right.x * f.z, z: right.x * f.y - right.y * f.x };
  const d = { x: p.x - pose.position.x, y: p.y - pose.position.y, z: p.z - pose.position.z };
  const dot = (a: typeof d, b: typeof d): number => a.x * b.x + a.y * b.y + a.z * b.z;
  const zc = dot(d, f);
  const m = pose.projection;
  const p5 = m && m[5] ? m[5] : 1 / Math.tan(30 * R);
  const p0 = m && m[0] ? m[0] : p5 / (W / H);
  // up = right x f points up when yaw = 0 and pitch = 0: check sign so +y world is up on screen
  const yc = dot(d, up);
  return { x: (W / 2) * (1 + (dot(d, right) * p0) / zc), y: (H / 2) * (1 - (yc * p5) / zc), depth: zc };
}

export type HudOptions = {
  host: HTMLElement; pkg: BuildingPackage; world: World; bus: CueBus;
  /** SDK (x, z) of a plan point, and the floor height under the camera. */
  toSdk: (p: Vec2) => { x: number; z: number };
  route?: Route | null;
  /** Pixels at the bottom and top kept free for the page's buttons. */
  safeBottom?: number; safeTop?: number;
};

const FONT = "600 18px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

export class Hud {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private map: HTMLCanvasElement;
  private mapBase: HTMLCanvasElement;
  private pose: CamPose | null = null;
  private floorY = 0;
  private pos: Vec2 = [0, 0];
  private heading = 0;
  private raf = 0;
  private pings: { az: number; t: number; label?: string }[] = [];
  private unsub: () => void;
  private route: Route | null;
  private dest: Landmark | null = null;
  private lastDraw = 0;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private safeBottom: number; private safeTop: number;

  constructor(private o: HudOptions) {
    this.route = o.route ?? o.pkg.routes[0] ?? null;
    this.safeBottom = o.safeBottom ?? 130; this.safeTop = o.safeTop ?? 70;
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d")!;
    o.host.append(this.canvas);
    this.map = document.createElement("canvas");
    this.mapBase = this.buildMapBase();
    this.dest = this.route ? o.pkg.landmarks.find(l => l.id === this.route!.to) ?? null : null;
    this.unsub = o.bus.subscribe(c => {
      if (!c.at || c.kind === "bump") return;
      const l = o.bus.listener;
      this.pings.push({ az: wrap180(bearing(l.pos, c.at) - l.heading), t: performance.now(), label: c.label });
      if (this.pings.length > 24) this.pings.shift();
    });
    const loop = (): void => { this.raf = requestAnimationFrame(loop); this.draw(); };
    this.raf = requestAnimationFrame(loop);
  }

  setPose(p: CamPose): void { this.pose = p; this.floorY = p.position.y - 1.35; }
  setWalker(pos: Vec2, heading: number): void { this.pos = pos; this.heading = heading; }
  destroy(): void { cancelAnimationFrame(this.raf); this.unsub(); this.canvas.remove(); }

  private buildMapBase(): HTMLCanvasElement {
    const { world } = this.o, c = document.createElement("canvas");
    c.width = world.w; c.height = world.h;
    const g = c.getContext("2d")!, img = g.createImageData(world.w, world.h);
    // crop to the used area so the map is not mostly empty
    for (let r = 0; r < world.h; r++) for (let col = 0; col < world.w; col++) {
      const v = world.cells[r * world.w + col];
      const o = ((world.h - 1 - r) * world.w + col) * 4; // row 0 is the lowest y: flip for the screen
      const [R_, G, B, A] = v === 0 ? [255, 255, 255, 0] : v === 1 ? [30, 41, 59, 255] : [100, 116, 139, 255];
      img.data[o] = R_; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = A;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** The route point about `ahead` metres past the walker's nearest path point. */
  private pathAhead(ahead: number): Vec2[] {
    const path = this.route?.path ?? [];
    if (path.length < 2) return [];
    let bi = 0, bd = Infinity;
    path.forEach((p, i) => { const d = dist(p, this.pos); if (d < bd) { bd = d; bi = i; } });
    const out: Vec2[] = []; let acc = 0;
    for (let i = bi; i < path.length - 1 && acc < ahead; i++) { out.push(path[i + 1]); acc += dist(path[i], path[i + 1]); }
    return out;
  }

  private nextLandmark(): Landmark | null {
    if (!this.route) return null;
    const ids = new Set(this.route.segments.flatMap(s => s.landmarks_passed));
    let best: Landmark | null = null, bs = Infinity;
    for (const l of this.o.pkg.landmarks) {
      if (!ids.has(l.id) || l.id === this.dest?.id || !l.spoken || /possibl/i.test(l.spoken) || l.confidence < 0.6) continue;
      const d = dist(this.pos, l.pos), az = Math.abs(wrap180(bearing(this.pos, l.pos) - this.heading));
      if (d < 1.2 || d > 9 || az > 80) continue;
      const s = d + az / 40;
      if (s < bs) { bs = s; best = l; }
    }
    return best;
  }

  private draw(): void {
    const now = performance.now();
    if (now - this.lastDraw < 30) return; // ~30 fps is plenty for overlays
    this.lastDraw = now;
    const { host } = this.o, W = host.clientWidth, H = host.clientHeight, d = this.dpr;
    if (this.canvas.width !== Math.round(W * d) || this.canvas.height !== Math.round(H * d)) {
      this.canvas.width = Math.round(W * d); this.canvas.height = Math.round(H * d);
    }
    const g = this.ctx;
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
    if (this.pose) { this.drawArrows(g, W, H); this.drawLabels(g, W, H); }
    this.drawCompass(g, W, H);
    this.drawMap(g, W, H);
  }

  private pt(p: Vec2, h: number, W: number, H: number): Screen | null {
    if (!this.pose) return null;
    const s = this.o.toSdk(p);
    const sc = project(this.pose, { x: s.x, y: this.floorY + h, z: s.z }, W, H);
    return sc.depth > 0.3 ? sc : null;
  }

  private drawArrows(g: CanvasRenderingContext2D, W: number, H: number): void {
    const pts = this.pathAhead(9);
    if (!pts.length) return;
    // resample at 1.2 m so the arrows read as a trail on the floor
    const trail: Vec2[] = []; let prev = this.pos, carry = 0.8;
    for (const p of pts) {
      const seg = dist(prev, p);
      while (carry <= seg) { const t = carry / seg; trail.push([prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t]); carry += 1.2; }
      carry -= seg; prev = p;
    }
    trail.slice(0, 8).forEach((p, i, a) => {
      const q = i + 1 < a.length ? a[i + 1] : pts[pts.length - 1];
      const s0 = this.pt(p, 0, W, H), s1 = this.pt([p[0] + (q[0] - p[0]) * 0.25, p[1] + (q[1] - p[1]) * 0.25], 0, W, H);
      if (!s0 || !s1) return;
      const ang = Math.atan2(s1.y - s0.y, s1.x - s0.x), k = Math.max(0.35, Math.min(1.4, 3.2 / s0.depth));
      g.save(); g.translate(s0.x, s0.y); g.rotate(ang); g.scale(k, k * 0.8);
      g.globalAlpha = Math.max(0.25, 1 - i * 0.1);
      g.beginPath(); g.moveTo(26, 0); g.lineTo(-14, -22); g.lineTo(-6, 0); g.lineTo(-14, 22); g.closePath();
      g.fillStyle = "#ffd60a"; g.strokeStyle = "rgba(0,0,0,0.75)"; g.lineWidth = 3; g.stroke(); g.fill();
      g.restore();
    });
  }

  private chip(g: CanvasRenderingContext2D, text: string, x: number, y: number, W: number, H: number, accent: string): void {
    g.font = FONT;
    const w = g.measureText(text).width + 28, h = 34;
    const cx = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, x)), cy = Math.max(this.safeTop + h, Math.min(H - this.safeBottom - h, y));
    g.save(); g.shadowColor = "rgba(0,0,0,0.35)"; g.shadowBlur = 10; g.shadowOffsetY = 3;
    g.fillStyle = "#fff"; g.beginPath(); g.roundRect(cx - w / 2, cy - h / 2, w, h, 17); g.fill(); g.restore();
    g.fillStyle = accent; g.beginPath(); g.arc(cx - w / 2 + 12, cy, 5, 0, 7); g.fill();
    g.fillStyle = "#0b1020"; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(text, cx - w / 2 + 22, cy + 1);
  }

  private drawLabels(g: CanvasRenderingContext2D, W: number, H: number): void {
    const items: { l: Landmark; accent: string }[] = [];
    if (this.dest?.spoken) items.push({ l: this.dest, accent: "#0a84ff" });
    const nl = this.nextLandmark(); if (nl) items.push({ l: nl, accent: "#ff9f0a" });
    const placed: { y: number; x: number }[] = [];
    for (const { l, accent } of items) {
      const s = this.pt(l.pos, 1.3, W, H);
      const text = (l.spoken ?? "").replace(/possibly\s*/i, "");
      if (!text) continue;
      let x: number, y: number;
      if (s) { x = s.x; y = s.y; } else { // behind: pin to the side it is on
        const az = wrap180(bearing(this.pos, l.pos) - this.heading); x = az > 0 ? W - 120 : 120; y = H * 0.45;
      }
      if (placed.some(p => Math.abs(p.y - y) < 40 && Math.abs(p.x - x) < 260)) y += 46;
      placed.push({ x, y });
      this.chip(g, text, x, y, W, H, accent);
    }
  }

  private drawCompass(g: CanvasRenderingContext2D, W: number, H: number): void {
    const cx = W / 2, cy = H - 64, rw = Math.min(360, W * 0.5), now = performance.now();
    g.save(); g.fillStyle = "rgba(255,255,255,0.88)"; g.shadowColor = "rgba(0,0,0,0.3)"; g.shadowBlur = 8;
    g.beginPath(); g.roundRect(cx - rw / 2 - 12, cy - 22, rw + 24, 44, 22); g.fill(); g.restore();
    g.strokeStyle = "#0b1020"; g.lineWidth = 2; g.fillStyle = "#0b1020"; g.font = "700 14px ui-sans-serif, system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
    for (let a = -90; a <= 90; a += 30) {
      const x = cx + (a / 90) * (rw / 2);
      g.beginPath(); g.moveTo(x, cy + 6); g.lineTo(x, cy + 14); g.stroke();
    }
    const dirs = ["N", "E", "S", "W"];
    for (let k = 0; k < 4; k++) {
      const az = wrap180(k * 90 - this.heading);
      if (Math.abs(az) <= 90) g.fillText(dirs[k], cx + (az / 90) * (rw / 2), cy + 1);
    }
    // clock hour ticks for what the sound ring is saying
    this.pings = this.pings.filter(p => now - p.t < 2600);
    for (const p of this.pings) {
      const a = Math.max(-90, Math.min(90, p.az)), x = cx + (a / 90) * (rw / 2), fade = 1 - (now - p.t) / 2600;
      g.globalAlpha = fade; g.fillStyle = Math.abs(p.az) > 90 ? "#ff453a" : "#0a84ff";
      g.beginPath(); g.arc(x, cy - 2, 8, 0, 7); g.fill(); g.globalAlpha = 1;
    }
    g.fillStyle = "#0b1020"; g.beginPath(); g.moveTo(cx, cy - 22); g.lineTo(cx - 7, cy - 32); g.lineTo(cx + 7, cy - 32); g.fill();
  }

  private drawMap(g: CanvasRenderingContext2D, W: number, _H: number): void {
    const { world } = this.o, mw = 190, mh = Math.round(mw * (world.h / world.w)), x0 = W - mw - 16, y0 = this.safeTop + 6;
    g.save(); g.shadowColor = "rgba(0,0,0,0.3)"; g.shadowBlur = 8; g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath(); g.roundRect(x0 - 6, y0 - 6, mw + 12, mh + 12, 10); g.fill(); g.restore();
    g.imageSmoothingEnabled = false; g.drawImage(this.mapBase, x0, y0, mw, mh);
    const sx = (p: Vec2): number => x0 + ((p[0] - world.origin[0]) / (world.w * world.res)) * mw;
    const sy = (p: Vec2): number => y0 + mh - ((p[1] - world.origin[1]) / (world.h * world.res)) * mh;
    if (this.route) {
      g.strokeStyle = "#ffd60a"; g.lineWidth = 2; g.beginPath();
      this.route.path.forEach((p, i) => (i ? g.lineTo(sx(p), sy(p)) : g.moveTo(sx(p), sy(p)))); g.stroke();
    }
    const px = sx(this.pos), py = sy(this.pos), h = this.heading * R;
    g.fillStyle = "#0a84ff"; g.strokeStyle = "#fff"; g.lineWidth = 2;
    g.beginPath(); g.arc(px, py, 5, 0, 7); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(px + Math.sin(h) * 12, py - Math.cos(h) * 12);
    g.lineTo(px + Math.sin(h + 2.5) * 6, py - Math.cos(h + 2.5) * 6); g.lineTo(px + Math.sin(h - 2.5) * 6, py - Math.cos(h - 2.5) * 6); g.fill();
  }
}
