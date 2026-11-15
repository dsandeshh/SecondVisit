import "../styles/tokens.css";
// Pick tool for overrides.json (Task 3): entrance, destination, extra landmarks and face calibration.
// Data comes from engine/scripts/export_pick.py (pick.json, floorplan.jpg, faces/) and, when built,
// package.json (grid overlay). Everything under public/buildings/<sid>/ is gitignored sponsor data.
import { buildOverrides, calibrateYaw0, faceBearing, headingFromDrag, planToPx, pxToPlan,
  type FloorPlan, type PickState, type Vec2 } from "./geom";

interface Pano { id: string; label: string; pos: Vec2; yaw: number } // yaw: skybox yaw, ccw degrees
interface PickData { sid: string; floorplan: FloorPlan & { url: string }; panos: Pano[];
  walls: [number, number, number, number][]; face_px: number; overrides: Record<string, any> }
interface GridJson { res: number; width: number; height: number; origin: Vec2; cells_b64: string }

const SCALE = 0.5; // canvas pixels per floor plan image pixel
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sid = new URLSearchParams(location.search).get("b") ?? "x37LjPx62VA";
const base = `/buildings/${sid}/`;
const canvas = $<HTMLCanvasElement>("plan");
const ctx = canvas.getContext("2d")!;
const status = (t: string) => { $("status").textContent = t; };
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#000";

let data: PickData;
let img: HTMLImageElement | null = null;
let grid: GridJson | null = null;
let gridCells: Uint8Array | null = null;
let facePick: { pano: string; face: number; xPx: number } | null = null;
const state: PickState = { entrance: null, destination: null, extra: [], deleted: [], yaw0: 0, clockwise: true,
  arrival: null };

function toCanvas(p: Vec2): Vec2 {
  const [x, y] = planToPx(data.floorplan, p);
  return [x * SCALE, y * SCALE];
}

function eventPlan(e: PointerEvent): Vec2 {
  const r = canvas.getBoundingClientRect();
  const cx = ((e.clientX - r.left) / r.width) * canvas.width;
  const cy = ((e.clientY - r.top) / r.height) * canvas.height;
  return pxToPlan(data.floorplan, [cx / SCALE, cy / SCALE]);
}

function dot(p: Vec2, rad: number, fill: string, stroke = css("--d-wall")) {
  const [x, y] = toCanvas(p);
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function ray(from: Vec2, bearing: number, len: number, color: string) {
  const b = (bearing * Math.PI) / 180;
  const [x0, y0] = toCanvas(from);
  const [x1, y1] = toCanvas([from[0] + Math.sin(b) * len, from[1] + Math.cos(b) * len]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
}

function text(p: Vec2, s: string, color: string) {
  const [x, y] = toCanvas(p);
  ctx.font = `600 16px ${css("--font-sans")}`;
  ctx.fillStyle = color;
  ctx.fillText(s, x + 9, y - 9);
}

function draw() {
  const fp = data.floorplan;
  ctx.fillStyle = css("--c-surface");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (img) {
    ctx.globalAlpha = Number(css("--d-plan-image-opacity")) || 0.35;
    ctx.drawImage(img, 0, 0, fp.width * SCALE, fp.height * SCALE);
    ctx.globalAlpha = 1;
  }
  if (grid && gridCells) {
    const colors: Record<number, string> = { 1: css("--d-wall"), 2: css("--d-obstacle"), 3: css("--d-obstacle"),
      4: css("--d-glass"), 5: css("--d-stairs-a") };
    ctx.globalAlpha = 0.5;
    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        const v = gridCells[r * grid.width + c];
        if (!v) continue;
        const [x, y] = toCanvas([grid.origin[0] + c * grid.res, grid.origin[1] + (r + 1) * grid.res]);
        ctx.fillStyle = colors[v] ?? css("--d-wall");
        ctx.fillRect(x, y, grid.res * fp.resolution * SCALE + 0.5, grid.res * fp.resolution * SCALE + 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = css("--d-wall");
  ctx.lineWidth = 2;
  for (const [ax, ay, bx, by] of data.walls) {
    const a = toCanvas([ax, ay]);
    const b = toCanvas([bx, by]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  const sel = $<HTMLSelectElement>("pano").value;
  for (const p of data.panos) {
    dot(p.pos, p.id === sel ? 9 : 6, p.id === sel ? css("--c-accent") : css("--c-surface"));
    text(p.pos, p.label, css("--c-ink"));
    if (p.id === sel) {
      for (let f = 1; f <= 4; f++) {
        ray(p.pos, faceBearing(f, data.face_px / 2, data.face_px, panoYaw0(p), state.clockwise), 1.2, css("--c-ink-2"));
        const b = (faceBearing(f, data.face_px / 2, data.face_px, panoYaw0(p), state.clockwise) * Math.PI) / 180;
        text([p.pos[0] + Math.sin(b) * 1.4, p.pos[1] + Math.cos(b) * 1.4], `F${f}`, css("--c-ink-2"));
      }
    }
  }
  if (facePick) {
    const p = data.panos.find((q) => q.id === facePick!.pano);
    if (p) ray(p.pos, faceBearing(facePick.face, facePick.xPx, data.face_px, panoYaw0(p), state.clockwise), 12,
      css("--d-route"));
  }
  for (const l of state.extra) { dot(l.pos, 7, css("--d-obstacle")); text(l.pos, l.label, css("--c-ink")); }
  if (state.destination) {
    dot(state.destination.pos, 10, css("--c-mark"));
    text(state.destination.pos, `Destination: ${state.destination.label}`, css("--c-ink"));
  }
  if (state.entrance) {
    dot(state.entrance.pos, 10, css("--c-mark"));
    ray(state.entrance.pos, state.entrance.heading_deg, 1.5, css("--d-wall"));
    text(state.entrance.pos, "Entrance", css("--c-ink"));
  }
}

/** Bearing of face 1's centre for this pano: the calibrated constant minus the pano's own skybox yaw. */
const panoYaw0 = (p: Pano) => state.yaw0 - (p.yaw ?? 0);

function readPoint(): { pos: Vec2; heading: number } | null {
  const x = parseFloat($<HTMLInputElement>("px").value);
  const y = parseFloat($<HTMLInputElement>("py").value);
  if (!Number.isFinite(x) || !Number.isFinite(y)) { status("Pick or type a point first."); return null; }
  const h = parseFloat($<HTMLInputElement>("ph").value);
  return { pos: [x, y], heading: Number.isFinite(h) ? h : 0 };
}

function renderPins() {
  const rows: string[] = [];
  const f = (p: Vec2) => `${p[0].toFixed(2)}, ${p[1].toFixed(2)}`;
  if (state.entrance) rows.push(`<tr><td>Entrance</td><td></td><td></td><td>${f(state.entrance.pos)}</td><td>${state.entrance.heading_deg.toFixed(0)}</td><td></td></tr>`);
  if (state.destination) rows.push(`<tr><td>Destination</td><td>desk</td><td>${state.destination.label}</td><td>${f(state.destination.pos)}</td><td></td><td></td></tr>`);
  state.extra.forEach((l, i) => rows.push(`<tr><td>hand_${i + 1}</td><td>${l.kind}</td><td>${l.label}</td><td>${f(l.pos)}</td><td></td><td><button type="button" data-del="${i}">Remove hand_${i + 1}</button></td></tr>`));
  $("pins").innerHTML = rows.join("");
  draw();
}

function showFaces() {
  const id = $<HTMLSelectElement>("pano").value;
  const box = $("faces");
  box.innerHTML = "";
  for (let f = 1; f <= 4; f++) {
    const fig = document.createElement("figure");
    const im = document.createElement("img");
    im.src = `${base}faces/${id}_${f}.jpg`;
    im.alt = `Panorama ${id} face ${f}`;
    im.addEventListener("click", (e) => {
      const r = im.getBoundingClientRect();
      facePick = { pano: id, face: f, xPx: ((e.clientX - r.left) / r.width) * data.face_px };
      box.querySelectorAll("img").forEach((x) => x.classList.remove("picked"));
      im.classList.add("picked");
      const pano = data.panos.find((q) => q.id === id)!;
      const b = faceBearing(f, facePick.xPx, data.face_px, panoYaw0(pano), state.clockwise);
      $("facepick").textContent = `Face ${f}, column ${facePick.xPx.toFixed(0)} px: bearing ${b.toFixed(1)} degrees with the current yaw0.`;
      draw();
    });
    const cap = document.createElement("figcaption");
    cap.textContent = `Face ${f}`;
    fig.append(im, cap);
    box.append(fig);
  }
  draw();
}

function wire() {
  let down: Vec2 | null = null;
  canvas.addEventListener("pointerdown", (e) => { down = eventPlan(e); });
  canvas.addEventListener("pointerup", (e) => {
    if (!down) return;
    const up = eventPlan(e);
    $<HTMLInputElement>("px").value = down[0].toFixed(2);
    $<HTMLInputElement>("py").value = down[1].toFixed(2);
    const dragged = Math.hypot(up[0] - down[0], up[1] - down[1]) > 0.3;
    if (dragged) $<HTMLInputElement>("ph").value = headingFromDrag(down, up).toFixed(0);
    const near = data.panos.find((p) => Math.hypot(p.pos[0] - down![0], p.pos[1] - down![1]) < 0.4);
    if (near && !dragged) { $<HTMLSelectElement>("pano").value = near.id; showFaces(); }
    status(`Point x ${down[0].toFixed(2)}, y ${down[1].toFixed(2)}${dragged ? `, heading ${$<HTMLInputElement>("ph").value}` : ""}${near && !dragged ? `, panorama ${near.label}` : ""}.`);
    down = null;
  });
  $("b-entrance").addEventListener("click", () => {
    const p = readPoint(); if (!p) return;
    state.entrance = { pos: p.pos, heading_deg: p.heading };
    status("Entrance set."); renderPins();
  });
  $("b-destination").addEventListener("click", () => {
    const p = readPoint(); if (!p) return;
    state.destination = { pos: p.pos, label: $<HTMLInputElement>("plabel").value || "Destination" };
    status("Destination set."); renderPins();
  });
  $("b-landmark").addEventListener("click", () => {
    const p = readPoint(); if (!p) return;
    state.extra.push({ kind: $<HTMLSelectElement>("pkind").value, label: $<HTMLInputElement>("plabel").value || "Landmark", pos: p.pos });
    status(`Landmark hand_${state.extra.length} added.`); renderPins();
  });
  $("pins").addEventListener("click", (e) => {
    const i = (e.target as HTMLElement).dataset.del;
    if (i !== undefined) { state.extra.splice(Number(i), 1); status("Landmark removed."); renderPins(); }
  });
  $("pano").addEventListener("change", showFaces);
  $("yaw0").addEventListener("input", () => { state.yaw0 = parseFloat($<HTMLInputElement>("yaw0").value) || 0; draw(); });
  $("cw").addEventListener("change", () => { state.clockwise = $<HTMLInputElement>("cw").checked; draw(); });
  $("b-cal").addEventListener("click", () => {
    if (!facePick) { status("Click the desk in one of the faces first."); return; }
    if (!state.destination) { status("Set the destination (the desk) on the plan first."); return; }
    const p = data.panos.find((q) => q.id === facePick!.pano)!;
    state.yaw0 = (calibrateYaw0(p.pos, facePick.face, facePick.xPx, data.face_px, state.destination.pos,
      state.clockwise) + (p.yaw ?? 0) + 360) % 360;
    $<HTMLInputElement>("yaw0").value = state.yaw0.toFixed(1);
    status(`face_yaw0_deg set to ${state.yaw0.toFixed(1)}. Check one more panorama: click the desk in its face and see if the blue ray crosses the destination.`);
    draw();
  });
  $("b-export").addEventListener("click", () => {
    state.deleted = $<HTMLInputElement>("deleted").value.split(",").map((s) => s.trim()).filter(Boolean);
    const o = buildOverrides(state);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(o, null, 2) + "\n"], { type: "application/json" }));
    a.download = "overrides.json";
    a.click();
    status(`Downloaded overrides.json. Save it as data/${sid}/overrides.json.`);
  });
}

function loadOverrides(o: Record<string, any>) {
  if (o.entrance) state.entrance = { pos: o.entrance.pos, heading_deg: o.entrance.heading_deg ?? 0 };
  if (o.destination?.pos) state.destination = { pos: o.destination.pos, label: o.destination.label ?? "Destination" };
  state.extra = (o.extra_landmarks ?? []).map((l: any) => ({ kind: l.kind, label: l.label, pos: l.pos }));
  state.deleted = o.deleted_landmark_ids ?? [];
  state.yaw0 = o.face_yaw0_deg ?? 0;
  state.clockwise = o.faces_clockwise ?? true;
  state.arrival = o.arrival ?? null;
  $<HTMLInputElement>("yaw0").value = String(state.yaw0);
  $<HTMLInputElement>("cw").checked = state.clockwise;
  $<HTMLInputElement>("deleted").value = state.deleted.join(", ");
}

async function main() {
  const res = await fetch(`${base}pick.json`);
  if (!res.ok) {
    status(`No pick data for ${sid}. Run: cd engine && .venv/bin/python scripts/export_pick.py ${sid}`);
    return;
  }
  data = await res.json();
  canvas.width = Math.round(data.floorplan.width * SCALE);
  canvas.height = Math.round(data.floorplan.height * SCALE);
  const sel = $<HTMLSelectElement>("pano");
  for (const p of [...data.panos].sort((a, b) => Number(a.label) - Number(b.label))) {
    sel.add(new Option(`${p.label} (${p.id.slice(0, 6)}, ${p.pos[0].toFixed(1)}, ${p.pos[1].toFixed(1)})`, p.id));
  }
  loadOverrides(data.overrides ?? {});
  wire();
  const pkg = await fetch(`${base}package.json`).catch(() => null);
  if (pkg?.ok && (pkg.headers.get("content-type") ?? "").includes("json")) {
    grid = (await pkg.json()).grid as GridJson;
    gridCells = Uint8Array.from(atob(grid.cells_b64), (c) => c.charCodeAt(0));
  }
  img = new Image();
  img.onload = () => draw();
  img.src = `${base}${data.floorplan.url}`;
  renderPins();
  showFaces();
  status(`Loaded ${data.panos.length} panoramas for ${sid}${grid ? " with the grid" : ", no grid yet (package.json not built)"}.`);
}

main();
