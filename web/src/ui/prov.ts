// Provenance chips, layer meter and the spoken source line (Task 19, UI_DESIGN 3.5, CLAUDE.md rule 8).
import type { BuildingPackage, Prov, Route, Segment, Source } from "../types";

export type ChipKind = "MP" | "VX" | "CS" | "CALC" | "AI" | "HAND";
export const LOW_CONFIDENCE = 0.6;
const KIND: Record<Source, ChipKind> = { matterport: "MP", vexcel: "VX", costar: "CS", calc: "CALC", ai: "AI", hand: "HAND" };
const NAME: Record<Source, string> = {
  matterport: "Matterport scan", vexcel: "Vexcel aerial image", costar: "CoStar record",
  calc: "computed", ai: "labelled by AI", hand: "confirmed by a person",
};
export const METER_ORDER: ChipKind[] = ["MP", "VX", "CS", "AI", "CALC", "HAND"];

export const chipKind = (p: Prov): ChipKind => KIND[p.src];
export const isPossibly = (p: Prov): boolean => p.src === "ai" && (p.confidence ?? 1) < LOW_CONFIDENCE;

export function chipText(p: Prov): string {
  const k = chipKind(p);
  return k === "AI" && p.confidence != null ? `AI ${p.confidence.toFixed(2)}` : k;
}

function inputNames(p: Prov, prov: Record<string, Prov>): string[] {
  const out: string[] = [];
  for (const key of p.inputs ?? []) {
    const src = prov[key]?.src;
    const n = src ? NAME[src] : key;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Full text, for aria-label and the S key. */
export function describeProv(p: Prov, prov: Record<string, Prov> = {}): string {
  if (p.src === "calc") {
    const ins = inputNames(p, prov);
    return ins.length ? `Source: computed from ${ins.join(" and ")}` : "Source: computed";
  }
  if (p.src === "ai") {
    const c = p.confidence;
    const conf = c == null ? "" : `, confidence ${c.toFixed(2)}${isPossibly(p) ? ", possibly" : ""}`;
    return `Source: labelled by AI${conf}`;
  }
  return `Source: ${NAME[p.src]}`;
}

/** "a reception desk" becomes "possibly a reception desk" for a low confidence AI label. */
export const withPossibly = (text: string, p: Prov | undefined): string => (p && isPossibly(p) ? `possibly ${text}` : text);

let uid = 0;

/** A chip button plus its details region (toggle with click or Enter, Escape closes and refocuses). */
export function chip(doc: Document, key: string, p: Prov, prov: Record<string, Prov> = {}): { button: HTMLButtonElement; details: HTMLElement } {
  const id = `prov-${++uid}`;
  const kind = chipKind(p);
  const button = doc.createElement("button");
  button.type = "button";
  button.className = `chip chip--${kind.toLowerCase()}${isPossibly(p) ? " chip--possibly" : ""}`;
  button.textContent = chipText(p);
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", id);
  button.setAttribute("aria-label", `${describeProv(p, prov)}. Show details`);
  const details = doc.createElement("div");
  details.id = id; details.className = "chip__details"; details.hidden = true;
  const dl = doc.createElement("dl");
  const row = (dt: string, dd: string) => {
    const a = doc.createElement("dt"); a.textContent = dt;
    const b = doc.createElement("dd"); b.textContent = dd;
    dl.append(a, b);
  };
  row("Field", key);
  row("Reference", p.ref);
  row("Pulled", p.at.replace("T", " ").slice(0, 16));
  const ins = inputNames(p, prov);
  if (ins.length) row("Inputs", ins.join(", "));
  details.append(dl);
  const toggle = (open: boolean) => { details.hidden = !open; button.setAttribute("aria-expanded", String(open)); };
  button.addEventListener("click", () => toggle(details.hidden));
  details.addEventListener("keydown", e => { if (e.key === "Escape") { toggle(false); button.focus(); } });
  button.addEventListener("keydown", e => { if (e.key === "Escape" && !details.hidden) { toggle(false); e.stopPropagation(); } });
  return { button, details };
}

export function layerCounts(prov: Record<string, Prov>): Record<ChipKind, number> {
  const c: Record<ChipKind, number> = { MP: 0, VX: 0, CS: 0, AI: 0, CALC: 0, HAND: 0 };
  for (const p of Object.values(prov ?? {})) c[chipKind(p)]++;
  return c;
}

/** One line for speech and tests: "MP 23, VX 4, ...". */
export const meterText = (c: Record<ChipKind, number>): string => METER_ORDER.map(k => `${k} ${c[k]}`).join(", ");

export function renderLayerMeter(host: HTMLElement, pkg: BuildingPackage): void {
  const d = host.ownerDocument;
  host.replaceChildren();
  const counts = layerCounts(pkg.prov);
  const total = METER_ORDER.reduce((n, k) => n + counts[k], 0);
  host.hidden = total === 0;
  if (total === 0) return;
  const fig = d.createElement("figure");
  fig.className = "layer-meter";
  const cap = d.createElement("figcaption"); cap.textContent = "Where the facts come from";
  const dl = d.createElement("dl");
  for (const k of METER_ORDER) {
    const cell = d.createElement("div");
    if (k === "HAND") cell.className = "is-hand";
    const dt = d.createElement("dt"); dt.textContent = k;
    const dd = d.createElement("dd"); dd.textContent = String(counts[k]);
    cell.append(dt, dd);
    dl.append(cell);
  }
  const bar = d.createElement("div");
  bar.className = "layer-meter__bar"; bar.setAttribute("aria-hidden", "true");
  for (const k of METER_ORDER) {
    if (!counts[k]) continue;
    const seg = d.createElement("span");
    seg.className = `layer-meter__seg${k === "HAND" ? " is-hand" : ""}`;
    seg.style.flexGrow = String(counts[k]);
    bar.append(seg);
  }
  const note = d.createElement("p");
  note.textContent = counts.HAND
    ? "Placed by a person: only the pins marked HAND. Everything else came from the scan, the aerial image and the record."
    : "Nothing here was placed by a person. Everything came from the scan, the aerial image and the record.";
  fig.append(cap, dl, bar, note);
  host.append(fig);
}

/** The provenance entry for a segment's spoken numbers: steps first, then clock. */
export function segmentProv(pkg: BuildingPackage, seg: Segment): { key: string; prov: Prov } | null {
  for (const f of ["steps", "clock"]) {
    const key = `segment:${seg.id}.${f}`;
    const p = pkg.prov?.[key];
    if (p) return { key, prov: p };
  }
  return null;
}

/** What S says in rehearsal: the source of the current instruction. */
export function sourceLine(pkg: BuildingPackage, route: Route, segIndex: number): string {
  const seg = route.segments[segIndex];
  if (!seg) return "No source for this line.";
  const sp = segmentProv(pkg, seg);
  if (!sp) return "No source recorded for this instruction.";
  const base = `${describeProv(sp.prov, pkg.prov)}.`;
  const lm = seg.landmarks_passed.map(id => pkg.prov?.[`landmark:${id}`]).find(Boolean);
  return lm ? `${base} Landmark: ${describeProv(lm, pkg.prov).replace("Source: ", "")}.` : base;
}
