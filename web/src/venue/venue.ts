import "../styles/tokens.css";
import "../styles/app.css";
import "../styles/venue.css";
// Venue view (Task 12 web, Portfolio tab Task 20). Talks to the agent stream (Task 13, POST /api/agent);
// never to /api/layout (R4). Numbers on screen come from the package or the stream's final report.
import type { BuildingPackage, PortfolioFile, PortfolioRow } from "../types";
import { decodeCells } from "../world";
import { fitCanvas, hatch, planPalette } from "../ui/tokens";
import { HEAT_BINS, beforeAfter, floorplanNote, heatBin, parseSse, sortRows, totalBuild, unscored,
  type Eval, type LayoutReport, type SortKey } from "./model";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const params = new URLSearchParams(location.search);
const sid = params.get("b") || "fixture";
const base = `${import.meta.env?.BASE_URL ?? "/"}buildings/${sid}/`;

let pkg: BuildingPackage | null = null;
let plan: { img: HTMLImageElement | null; fp: { origin: { x: number; y: number }; resolution: number } | null } = { img: null, fp: null };
let report: LayoutReport | null = null;

async function getJson<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// ---------------------------------------------------------------- tabs
function showTab(name: "layout" | "portfolio", focus = false) {
  for (const t of ["layout", "portfolio"] as const) {
    const on = t === name;
    $(`tab-${t}`).setAttribute("aria-selected", String(on));
    $(`tab-${t}`).tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  }
  if (focus) $(`tab-${name}`).focus();
  if (name === "portfolio") void loadPortfolio();
  else draw();
}
function wireTabs() {
  const order = ["layout", "portfolio"] as const;
  for (const t of order) {
    $(`tab-${t}`).addEventListener("click", () => showTab(t));
    $(`tab-${t}`).addEventListener("keydown", (e) => {
      const i = order.indexOf(t);
      if (e.key === "ArrowRight") showTab(order[(i + 1) % 2], true);
      else if (e.key === "ArrowLeft") showTab(order[(i + 1) % 2], true);
    });
  }
}

// ---------------------------------------------------------------- plan canvas
function draw() {
  const cv = $<HTMLCanvasElement>("plan");
  if (!pkg || $("panel-layout").hidden) return;
  const P = planPalette();
  const g = pkg.grid;
  cv.style.aspectRatio = `${g.width} / ${g.height}`;
  const ctx = fitCanvas(cv);
  const W = cv.getBoundingClientRect().width, H = cv.getBoundingClientRect().height;
  const s = Math.min(W / (g.width * g.res), H / (g.height * g.res));
  const X = (x: number) => (x - g.origin[0]) * s, Y = (y: number) => H - (y - g.origin[1]) * s;
  ctx.fillStyle = P.paper; ctx.fillRect(0, 0, W, H);
  if (plan.img && plan.fp) {  // Matterport origin is the image's bottom left corner, resolution px per metre
    const { origin: o, resolution: res } = plan.fp;
    ctx.save(); ctx.filter = "grayscale(1)"; ctx.globalAlpha = P.planOpacity;
    const w = plan.img.naturalWidth / res, h = plan.img.naturalHeight / res;
    ctx.drawImage(plan.img, X(o.x), Y(o.y + h), w * s, h * s); ctx.restore();
  }
  const cells = decodeCells(g.cells_b64), cs = g.res * s;
  const sim = pkg.routes[0] ? pkg.sim[pkg.routes[0].id] : undefined;
  const lost = sim ? decodeCells(sim.lost_cells_b64) : null;
  ctx.fillStyle = P.wall;
  const stair = hatch(ctx, P.stairsA, P.stairsB);
  for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) {
    const i = r * g.width + c, code = cells[i];
    const x = X(g.origin[0] + c * g.res), y = Y(g.origin[1] + (r + 1) * g.res);
    if (lost && sim) {
      const b = heatBin(lost[i], sim.runs);
      if (b >= 0) { ctx.globalAlpha = P.heatAlpha; ctx.fillStyle = P.heat[b]; ctx.fillRect(x, y, cs + 0.5, cs + 0.5); ctx.globalAlpha = 1; }
    }
    if (code === 1) { ctx.fillStyle = P.wall; ctx.fillRect(x, y, cs + 0.5, cs + 0.5); }
    else if (code === 2) { ctx.globalAlpha = 0.35; ctx.fillStyle = P.obstacle; ctx.fillRect(x, y, cs + 0.5, cs + 0.5); ctx.globalAlpha = 1; }
    else if (code === 3) { ctx.strokeStyle = P.obstacle; ctx.setLineDash([6, 4]); ctx.strokeRect(x, y, cs, cs); ctx.setLineDash([]); }
    else if (code === 4) { ctx.fillStyle = P.glass; ctx.fillRect(x, y, cs + 0.5, cs + 0.5); }
    else if (code === 5) { ctx.fillStyle = stair; ctx.fillRect(x, y, cs + 0.5, cs + 0.5); }
  }
  const route = pkg.routes[0];
  if (route) {  // current route: graphite solid
    ctx.lineWidth = 8; ctx.strokeStyle = P.casing; strokePath(ctx, route.path, X, Y);
    ctx.lineWidth = 4; ctx.strokeStyle = P.before; strokePath(ctx, route.path, X, Y);
  }
  ctx.font = "14px system-ui, sans-serif"; ctx.textBaseline = "middle";
  for (const lm of pkg.landmarks) {
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2; ctx.setLineDash(pkg.prov?.[`landmark:${lm.id}`]?.src === "ai" ? [2, 3] : []);
    ctx.beginPath(); ctx.arc(X(lm.pos[0]), Y(lm.pos[1]), 5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, lm.label, X(lm.pos[0]) + 9, Y(lm.pos[1]), P);
  }
  if (report?.best?.pos) {  // proposed desk: blue dashed square
    const [x, y] = [X(report.best.pos[0]), Y(report.best.pos[1])];
    ctx.strokeStyle = P.route; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.strokeRect(x - 9, y - 9, 18, 18); ctx.setLineDash([]);
    label(ctx, "Proposed desk", x + 13, y, P);
  }
  cv.setAttribute("aria-label", `Floor plan of ${pkg.name}: ${pkg.rooms.length} rooms, ${pkg.landmarks.length} landmarks, `
    + (route ? "current route in grey" : "no route") + (lost ? ", lost heatmap shaded (simulated)" : ""));
}
function strokePath(ctx: CanvasRenderingContext2D, p: [number, number][], X: (v: number) => number, Y: (v: number) => number) {
  ctx.beginPath(); p.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
}
function label(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, P: ReturnType<typeof planPalette>) {
  ctx.lineWidth = 4; ctx.strokeStyle = P.paper; ctx.strokeText(t, x, y); ctx.fillStyle = P.ink; ctx.fillText(t, x, y);
}

function legend() {
  const sims = pkg?.sim && Object.values(pkg.sim)[0];
  const swatches = [["Wall", "var(--d-wall)"], ["Fixed obstacle", "var(--d-obstacle)"], ["Glass", "var(--d-glass)"],
    ["Current route (grey)", "var(--d-before)"], ["Proposed desk (blue dashed)", "var(--d-route)"]]
    .map(([n, c]) => `<li><span class="sw" style="background:${c}"></span>${n}</li>`).join("");
  const heat = HEAT_BINS.map((b, i) => `<li><span class="sw" style="background:var(--heat-${i + 1})"></span>${b.label}</li>`).join("");
  $("legend").innerHTML = swatches
    + `<li class="legend--heat">Lost here <span class="tag tag--simulated">simulated</span>${sims ? `, ${sims.runs} runs` : ""}: <ul class="legend">${heat}</ul></li>`;
}

// ---------------------------------------------------------------- layout report
function renderReport(r: LayoutReport, mode: "agent" | "scripted" | "replay") {
  report = r;
  const tag = mode === "agent" ? "" : ` <span class="tag tag--${mode}">${mode}</span>`;
  if (r.current && r.best) {
    const rows = beforeAfter(r.current, r.best);
    $("ba").innerHTML = `<div class="data-region" role="region" aria-labelledby="ba-cap" tabindex="0"><table class="data">
      <caption id="ba-cap">Now and with changes${tag}</caption>
      <thead><tr><th scope="col">Measure</th><th scope="col" class="num">Now</th><th scope="col" class="num">With changes</th><th scope="col">Change</th></tr></thead><tbody>`
      + rows.map((x) => `<tr><th scope="row">${esc(x.measure)} <span class="${x.tag === "CALC" ? "chip" : "tag tag--simulated"}">${esc(x.tag)}</span></th>`
        + `<td class="num">${esc(x.now)}</td><td class="num">${esc(x.after)}</td><td>${esc(x.change)}</td></tr>`).join("")
      + `</tbody></table></div>`
      + `<div class="pairbar" aria-hidden="true"><span>Arrival now</span><i class="now" style="width:${Math.round(r.current.arrival_rate * 100)}%"></i>`
      + `<span>With changes</span><i class="after" style="width:${Math.round(r.best.arrival_rate * 100)}%"></i></div>`;
  } else {
    $("ba").innerHTML = `<p class="note">The report has no numbers to compare.${tag}</p>`;
  }
  const fx = (r.best?.fixes ?? []) as { kind?: string }[];
  const pos = r.best?.pos ? `Move the desk to (${r.best.pos[0].toFixed(1)}, ${r.best.pos[1].toFixed(1)}) m` : "";
  $("fixes").innerHTML = [pos, ...fx.map((f) => String(f.kind ?? "fix").replace("_", " "))].filter(Boolean)
    .map((t) => `<li>${esc(t)}</li>`).join("") || `<li class="note">No change proposed.</li>`;
  $("rounds").innerHTML = r.rounds.map((x) => `<li>${esc(x.proposal)}<br><span class="chip chip--ai">AI</span> ${esc(x.critique)}</li>`).join("")
    || `<li class="note">No rounds recorded.</li>`;
  draw();
}

function offlineView(why: string) {
  $("mode-note").innerHTML = `Layout advisor offline (${esc(why)}). Showing the current layout from the building package only, no proposal. <span class="tag tag--scripted">scripted</span>`;
  const r0 = pkg?.routes[0];
  if (r0) {
    const sim = pkg!.sim[r0.id];
    $("ba").innerHTML = `<p>Current route: score ${r0.score.total.toFixed(1)} <span class="chip">CALC</span>`
      + (sim ? `, arrival ${Math.round(sim.arrival_rate * 100)}% <span class="tag tag--simulated">simulated</span>` : "") + `.</p>`
      + `<p class="note">No better layout has been computed. Start the engine (uvicorn dr.api:app) and run the advisor again.</p>`;
  }
}

function traceLine(ev: Record<string, unknown>) {
  const t = new Date().toTimeString().slice(0, 8);
  const who = String(ev.agent ?? ev.to ?? "orchestrator");
  let text = "", st = "";
  switch (ev.type) {
    case "delegate": text = `delegate: ${ev.task ?? ""}`; break;
    case "tool_call": text = `${ev.tool}(${JSON.stringify(ev.args ?? {}).slice(0, 80)})`; st = "running"; break;
    case "tool_result": text = `${ev.tool}: ${ev.summary ?? ""}`; st = ev.ok === false ? "failed" : "done"; break;
    case "thought": text = String(ev.text ?? ""); break;
    case "fallback": text = `scripted fallback: ${ev.reason ?? ""}`; st = "scripted"; break;
    case "error": text = String(ev.message ?? "error"); st = "failed"; break;
    case "final": text = "final report"; st = "done"; break;
    default: return;
  }
  const li = document.createElement("li");
  li.innerHTML = `<span class="t">${t}</span><span><span class="who">${esc(who)}</span> <span class="${ev.type === "tool_call" ? "tool" : ""}">${esc(text)}</span></span><span class="st">${esc(st)}</span>`;
  $("trace").append(li);
  while ($("trace").children.length > 200) $("trace").firstElementChild!.remove();
  li.scrollIntoView?.({ block: "nearest" });
}

async function runAdvisor() {
  $("trace").innerHTML = ""; $("mode-note").textContent = ""; $("trace-status").textContent = "Running";
  let mode: "agent" | "scripted" | "replay" = "agent", got = false;
  try {
    const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Where should reception go?", building_id: sid }) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const rd = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { events, rest } = parseSse(buf); buf = rest;
      for (const ev of events) {
        traceLine(ev);
        if (ev.type === "fallback") mode = "scripted";
        if (ev.type === "final") {
          const result = ev.result as { report?: LayoutReport; mode?: string };
          if (result.mode === "replay") mode = "replay";
          if (result.report) { got = true; renderReport(result.report, mode); }
        }
      }
    }
    $("trace-status").textContent = got ? "Layout advisor finished" : "Layout advisor ended without a report";
    if (!got) offlineView("no report came back");
  } catch (e) {
    $("trace-status").textContent = "Layout advisor could not be reached";
    const baked = await getJson<LayoutReport>(`${base}layout_report.json`);
    if (baked) { $("mode-note").innerHTML = `Agent stream offline. Showing a saved report. <span class="tag tag--replay">replay</span>`; renderReport(baked, "replay"); }
    else offlineView(e instanceof Error ? e.message : "no connection");
  }
}

// ---------------------------------------------------------------- portfolio
let pf: PortfolioFile | null = null, sortKey: SortKey = "total", desc = true, pfLoaded = false;
const pct = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "n/a" : `${Math.round(v * 100)}%`);
const num = (v: number | undefined, d = 1) => (v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(d));
const cs = (r: PortfolioRow, ...keys: string[]) => {
  const p = (r.costar?.property ?? {}) as Record<string, unknown>;
  for (const k of keys) if (p[k] != null && p[k] !== "") return String(p[k]);
  return "";
};

async function loadPortfolio() {
  if (pfLoaded) return;
  pfLoaded = true;
  pf = await getJson<PortfolioFile>(`${import.meta.env?.BASE_URL ?? "/"}portfolio.json`);
  renderPortfolio();
}

function renderPortfolio() {
  if (!pf) {
    $("pf-summary").textContent = "No portfolio has been built yet.";
    $("pf-table").innerHTML = `<p class="note">Build it with python -m dr.cli portfolio --city Houston --n 20 --out ../web/public/portfolio.json, then reload. It is not committed because it comes from sponsor data.</p>`;
    return;
  }
  const rows = pf.rows, scored = sortRows(rows, sortKey, desc), bad = unscored(rows);
  $("pf-summary").innerHTML = `${scored.length} of ${rows.length} suites scored in ${totalBuild(rows)} <span class="chip">CALC</span> `
    + `Entrance for each is assumed <span class="tag tag--assumed">assumed</span>`;
  const max = Math.max(1, ...scored.map((r) => r.total ?? 0));
  const th = (k: SortKey, text: string, cls = "") => {
    const on = k === sortKey;
    return `<th scope="col" class="${cls}" aria-sort="${on ? (desc ? "descending" : "ascending") : "none"}">`
      + `<button type="button" data-sort="${k}">${text}${on ? (desc ? " high to low" : " low to high") : ""}</button></th>`;
  };
  $("pf-table").innerHTML = `<div class="data-region" role="region" aria-labelledby="pf-cap" tabindex="0"><table class="data">`
    + `<caption id="pf-cap">Ranked by how easy they are to learn${pf.city ? `, ${esc(pf.city)}` : ""}</caption><thead><tr>`
    + th("rank", "Rank", "num") + th("name", "Building and address")
    + `<th scope="col">Type, class <span class="chip">CS</span></th>`
    + th("total", `Score <span class="chip">CALC</span>`, "num") + th("wall_share", "Wall share", "num")
    + th("decisions", "Decisions", "num") + th("open_m", "Open (m)", "num")
    + `<th scope="col">Entrance</th>` + th("build_s", "Build (s)", "num") + `<th scope="col">Rehearse</th></tr></thead><tbody>`
    + scored.map((r) => `<tr><td class="num">${r.rank ?? ""}</td>`
      + `<th scope="row">${esc(r.name)}<br><span class="note">${esc(r.address)}</span> <a href="${esc(r.tour_url)}">3D tour</a></th>`
      + `<td>${esc([cs(r, "property_type", "type", "propertyType"), cs(r, "building_class", "class", "buildingClass")].filter(Boolean).join(", "))}</td>`
      + `<td class="num">${num(r.total ?? undefined, 1)}<span class="bar" style="width:${Math.round(((r.total ?? 0) / max) * 80)}px"></span></td>`
      + `<td class="num">${pct(r.parts.mean_wall_share)}</td><td class="num">${num(r.parts.mean_decisions)}</td>`
      + `<td class="num">${num(r.parts.open_m)}</td>`
      + `<td>${r.assumed_entrance ? `<span class="tag tag--assumed">assumed</span>` : "set"}</td>`
      + `<td class="num">${num(r.build_s, 1)}</td>`
      + `<td><a class="btn" href="/?b=${encodeURIComponent(r.sid)}">Open rehearsal</a></td></tr>`).join("")
    + `</tbody></table></div>`;
  $("pf-table").querySelectorAll<HTMLButtonElement>("button[data-sort]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.sort as SortKey;
    desc = k === sortKey ? !desc : k !== "rank" && k !== "name" && k !== "build_s" && k !== "decisions";
    sortKey = k; renderPortfolio();
    ($("pf-table").querySelector(`button[data-sort="${k}"]`) as HTMLElement | null)?.focus();
  }));
  const skipped = bad.filter((b) => b.kind === "skipped"), errs = bad.filter((b) => b.kind === "error");
  $("pf-unscored").innerHTML = (skipped.length ? `<h2>Skipped (${skipped.length}), data reason</h2><ul>`
      + skipped.map((b) => `<li>${esc(b.name || b.sid)}: ${esc(b.why)}</li>`).join("") + `</ul>` : "")
    + (errs.length ? `<h2>Errors (${errs.length}), not a data problem</h2><ul>`
      + errs.map((b) => `<li>${esc(b.name || b.sid)}: <strong>${esc(b.why)}</strong></li>`).join("") + `</ul>` : "");
}

// ---------------------------------------------------------------- boot
async function boot() {
  wireTabs();
  $("run").addEventListener("click", () => void runAdvisor());
  addEventListener("resize", draw);
  pkg = await getJson<BuildingPackage>(`${base}package.json`);
  $("venue-title").textContent = pkg ? `Venue view: ${pkg.name}` : "Venue view";
  if (!pkg) { $("plan-note").textContent = `No building package for ${sid}.`; }
  const fp = await getJson<{ origin: { x: number; y: number }; resolution: number }>(`${base}floorplan.json`);
  const img = await new Promise<HTMLImageElement | null>((ok) => {
    const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = `${base}floorplan.jpg`;
  });
  plan = { img: fp && img ? img : null, fp: fp && img ? fp : null };
  const note = floorplanNote(!!img, !!fp);
  $("plan-note").textContent = note ?? "";
  legend(); draw();
  if (location.hash === "#portfolio" || params.get("tab") === "portfolio") showTab("portfolio");
}
void boot();
