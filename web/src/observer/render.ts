import { fitCanvas, hatch, planPalette, reducedMotion } from "../ui/tokens";
import type { ObserverState } from "./observer";
import type { Bus } from "./bus";
import type { CellCode, PackageLite, Vec2 } from "./protocol";

const CANE_M = 1.2;
const rad = (d: number) => (d * Math.PI) / 180;

function decode(b64: string): Uint8Array {
  const s = atob(b64), a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

export function start(S: new () => ObserverState, openBus: (s: string, o?: { relay?: boolean }) => Bus) {
  const q = new URLSearchParams(location.search);
  const sid = q.get("b") ?? "fixture", session = q.get("obs") ?? "demo";
  const cv = document.getElementById("plan") as HTMLCanvasElement;
  const $ = (id: string) => document.getElementById(id)!;
  const st = new S();
  let pkg: PackageLite | null = null, cells: Uint8Array | null = null;
  let img: HTMLImageElement | null = null, imgOrigin: Vec2 = [0, 0], imgRes = 100;

  const bus = openBus(session, { relay: q.get("relay") === "1" });
  bus.subscribe((m) => { st.apply(m); text(); });

  fetch(`/buildings/${sid}/package.json`).then((r) => r.json()).then((p: PackageLite) => {
    pkg = p; cells = decode(p.grid.cells_b64); $("title").textContent = p.name;
  }).catch(() => { $("caption").textContent = "No package loaded"; });
  fetch(`/buildings/${sid}/floorplan.json`).then((r) => r.json()).then((j) => {
    imgOrigin = [j.origin.x, j.origin.y]; imgRes = j.resolution;
    const i = new Image(); i.onload = () => { img = i; }; i.src = `/buildings/${sid}/floorplan.jpg`;
  }).catch(() => { /* no floor plan: walls only */ });

  function text() {
    $("caption").textContent = st.lastSay ? `They hear: "${st.lastSay}"` : "";
    const segs = pkg?.routes[0]?.segments.length ?? 0;
    $("runinfo").textContent = `Run ${st.run}${segs ? `  Stretch ${Math.min(st.seg + 1, segs)} of ${segs}` : ""}`;
    $("coach").textContent = st.coach?.line ?? "";
    const row = (label: string, f: (e: NonNullable<ObserverState["summary"][number]>) => string) =>
      `<tr><th scope="row">${label}</th><td>${st.summary[1] ? f(st.summary[1]) : ""}</td><td>${st.summary[2] ? f(st.summary[2]) : ""}</td></tr>`;
    $("table").innerHTML = `<tr><th></th><th>Run 1</th><th>Run 2</th></tr>` +
      row("Time", (e) => `${Math.round(e.time_s)} s`) + row("Bumps", (e) => String(e.bumps)) +
      row("Off route", (e) => String(e.off_route)) + row("Quiz", (e) => `${e.quiz_correct} of ${e.quiz_total}`) +
      row("Pointing error", (e) => (e.point_error_deg == null ? "none" : `${Math.round(e.point_error_deg)}°`));
    $("quiz").textContent = st.quiz.map((x) => (x.correct ? "✓ Correct" : "✗ Not this one")).join("   ");
    $("point").textContent = Object.entries(st.points).map(([r, p]) => `Run ${r}: ${Math.round(p.error_deg)}°`).join("   ");
    cv.setAttribute("aria-label", pkg ? `Traveller on ${pkg.name}, run ${st.run}, stretch ${st.seg + 1}` : "Plan");
  }

  function cast(pos: Vec2, bearing: number): { end: Vec2; code: CellCode | null } {
    const g = pkg!.grid, d = rad(bearing), step = g.res / 2;
    for (let s = step; s <= CANE_M; s += step) {
      const p: Vec2 = [pos[0] + Math.sin(d) * s, pos[1] + Math.cos(d) * s];
      const c = Math.floor((p[0] - g.origin[0]) / g.res), r = Math.floor((p[1] - g.origin[1]) / g.res);
      const code = c < 0 || r < 0 || c >= g.width || r >= g.height ? 1 : cells![r * g.width + c];
      if (code !== 0) return { end: p, code: code as CellCode };
    }
    return { end: [pos[0] + Math.sin(d) * CANE_M, pos[1] + Math.cos(d) * CANE_M], code: null };
  }

  function draw() {
    const ctx = fitCanvas(cv), W = cv.clientWidth, H = cv.clientHeight, P = planPalette(), k = H / 1080;
    ctx.fillStyle = P.paper; ctx.fillRect(0, 0, W, H);
    if (!pkg || !cells) return;
    const g = pkg.grid, mw = g.width * g.res, mh = g.height * g.res;
    const sc = Math.min(W / mw, H / mh) * 0.96, ox = (W - mw * sc) / 2, oy = (H + mh * sc) / 2;
    const X = (x: number) => ox + (x - g.origin[0]) * sc, Y = (y: number) => oy - (y - g.origin[1]) * sc;
    const line = (pts: Vec2[], color: string, w: number, dash: number[] = []) => {
      if (pts.length < 2) return;
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
      ctx.strokeStyle = color; ctx.lineWidth = w * k; ctx.setLineDash(dash.map((d) => d * k)); ctx.stroke(); ctx.setLineDash([]);
    };
    const halo = (t: string, x: number, y: number, size = 3) => {
      ctx.font = `${(size * H) / 100}px system-ui, sans-serif`; ctx.textAlign = "left"; ctx.lineWidth = 4 * k;
      ctx.strokeStyle = P.paper; ctx.strokeText(t, x, y); ctx.fillStyle = P.ink2; ctx.fillText(t, x, y);
    };
    // 2 floor plan image
    if (img) {
      ctx.save(); ctx.filter = "grayscale(1)"; ctx.globalAlpha = P.planOpacity;
      const w = img.width / imgRes, h = img.height / imgRes;
      ctx.drawImage(img, X(imgOrigin[0]), Y(imgOrigin[1] + h), w * sc, h * sc); ctx.restore();
    }
    // 3 room labels
    for (const r of pkg.rooms) {
      if (!r.label || !r.polygon.length) continue;
      const c = r.polygon.reduce((a, p) => [a[0] + p[0] / r.polygon.length, a[1] + p[1] / r.polygon.length], [0, 0]);
      halo(r.label, X(c[0]) - 40 * k, Y(c[1]));
    }
    // 5-9 grid cells
    const cs = g.res * sc, hp = hatch(ctx, P.stairsA, P.stairsB, 12);
    for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) {
      const v = cells[r * g.width + c]; if (!v) continue;
      const x = X(g.origin[0] + c * g.res), y = Y(g.origin[1] + (r + 1) * g.res);
      if (v === 1) { const w = Math.max(cs, 4 * k); ctx.fillStyle = P.wall; ctx.fillRect(x, y, w, w); }
      else if (v === 2) { ctx.globalAlpha = 0.35; ctx.fillStyle = P.obstacle; ctx.fillRect(x, y, cs, cs); ctx.globalAlpha = 1; ctx.strokeStyle = P.obstacle; ctx.lineWidth = 2 * k; ctx.strokeRect(x, y, cs, cs); }
      else if (v === 3) { ctx.strokeStyle = P.obstacle; ctx.lineWidth = 2 * k; ctx.setLineDash([6 * k, 4 * k]); ctx.strokeRect(x, y, cs, cs); ctx.setLineDash([]); }
      else if (v === 4) { ctx.strokeStyle = P.glass; ctx.lineWidth = 2 * k; ctx.strokeRect(x, y, cs, cs); ctx.strokeRect(x + 3 * k, y + 3 * k, Math.max(cs - 6 * k, 1), Math.max(cs - 6 * k, 1)); }
      else if (v === 5) { ctx.fillStyle = hp; ctx.fillRect(x, y, cs, cs); }
    }
    // 10 route: casing, completed graphite, current thicker
    const route = pkg.routes[0];
    if (route) {
      line(route.path, "#fff", 11); line(route.path, P.route, 8);
      route.segments.forEach((s, i) => {
        if (i < st.seg) line([s.start, s.end], P.before, 4);
        else if (i === st.seg) { line([s.start, s.end], "#fff", 15); line([s.start, s.end], P.route, 12); }
      });
      if (st.coach) { const s = route.segments[st.coach.focus_segment]; if (s) line([s.start, s.end], P.ink, 3, [10, 6]); }
    }
    // 11 trails
    for (const [r, t] of Object.entries(st.trails)) {
      const run1 = r === "1";
      line(t, run1 ? P.before : P.route, run1 ? 4 : 6, run1 ? [10, 8] : []);
      const e = t[t.length - 1]; if (e) halo(`Run ${r}`, X(e[0]) + 12 * k, Y(e[1]) - 12 * k);
    }
    // 12-13 landmarks, destination
    for (const l of pkg.landmarks) {
      ctx.beginPath(); ctx.arc(X(l.pos[0]), Y(l.pos[1]), 10 * k, 0, 7); ctx.strokeStyle = P.ink; ctx.lineWidth = 3 * k; ctx.stroke();
      halo((l.confidence < 0.6 ? "possibly " : "") + l.label, X(l.pos[0]) + 16 * k, Y(l.pos[1]) + 8 * k);
    }
    const dest = route && pkg.landmarks.find((l) => l.id === route.to);
    if (dest) { ctx.fillStyle = P.ink; ctx.fillRect(X(dest.pos[0]) - 8 * k, Y(dest.pos[1]) - 8 * k, 16 * k, 16 * k); }
    // 17 pointing (drawn under the traveller)
    const p = st.points[st.run];
    if (p) {
      const L = 4;
      line([p.from, [p.from[0] + Math.sin(rad(p.target_bearing)) * L, p.from[1] + Math.cos(rad(p.target_bearing)) * L]], P.ink, 4);
      line([p.from, [p.from[0] + Math.sin(rad(p.heading)) * L, p.from[1] + Math.cos(rad(p.heading)) * L]], P.route, 6);
      ctx.beginPath(); ctx.moveTo(X(p.from[0]), Y(p.from[1]));
      ctx.arc(X(p.from[0]), Y(p.from[1]), 2.5 * sc, rad(p.target_bearing - 90), rad(p.heading - 90), p.heading < p.target_bearing);
      ctx.closePath(); ctx.globalAlpha = 0.5; ctx.fillStyle = hp; ctx.fill(); ctx.globalAlpha = 1;
    }
    // 14 cane, 16 traveller
    if (st.pose) {
      const { pos, heading, cane_deg } = st.pose, hit = cast(pos, heading + cane_deg);
      const col = hit.code === 1 ? P.wall : hit.code === 4 ? P.glass : hit.code === 2 || hit.code === 3 ? P.obstacle : P.caneFree;
      line([pos, hit.end], col, 3);
      ctx.beginPath(); ctx.arc(X(pos[0]), Y(pos[1]), 16 * k, 0, 7); ctx.fillStyle = P.traveller; ctx.fill();
      ctx.strokeStyle = P.travellerRing; ctx.lineWidth = 4 * k; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(pos[0]), Y(pos[1]));
      for (const a of [-30, 30]) ctx.lineTo(X(pos[0]) + Math.sin(rad(heading + a)) * 32 * k, Y(pos[1]) - Math.cos(rad(heading + a)) * 32 * k);
      ctx.closePath(); ctx.fillStyle = P.ink; ctx.fill();
    }
    // 15 tap rings: small, 300 ms, static under reduced motion
    const now = performance.now();
    for (const t of st.taps) {
      const age = now - t.rx; if (age > 300) continue;
      const r = reducedMotion() ? 17 * k : (10 + 14 * (age / 300)) * k, x = X(t.at[0]), y = Y(t.at[1]);
      ctx.lineWidth = 4 * k; ctx.globalAlpha = reducedMotion() ? 1 : 1 - age / 300;
      ctx.strokeStyle = t.code === 4 ? P.glass : t.code === 2 || t.code === 3 ? P.obstacle : P.ink;
      ctx.setLineDash(t.code === 3 ? [6 * k, 4 * k] : []);
      if (t.code === 2 || t.code === 3) ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
      else { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); if (t.code === 4) { ctx.beginPath(); ctx.arc(x, y, r + 6 * k, 0, 7); ctx.stroke(); } }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }
  const loop = () => { draw(); requestAnimationFrame(loop); };
  text(); loop();
}
