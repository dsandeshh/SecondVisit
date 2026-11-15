// Pure helpers for the venue view (Task 12 web, Task 20). No DOM here so vitest can cover them.
import type { PortfolioRow } from "../types";

/** Fixed lost-heatmap bins (UI_DESIGN 4.5): fractions of runs, so before and after maps compare. */
export const HEAT_BINS = [
  { max: 0.02, label: "up to 2%" },
  { max: 0.05, label: "2 to 5%" },
  { max: 0.10, label: "5 to 10%" },
  { max: Infinity, label: "over 10%" },
] as const;

/** Bin index 0..3, or -1 when no run was lost in the cell (left unfilled). */
export function heatBin(count: number, runs: number): number {
  if (count <= 0 || runs <= 0) return -1;
  const f = count / runs;
  return HEAT_BINS.findIndex((b) => f <= b.max);
}

export interface Eval { eval_id?: string; pos?: [number, number]; score: number; arrival_rate: number;
  open_m?: number; turns?: number; fixes?: unknown[]; }
export interface LayoutReport { current: Eval | null; best: Eval | null;
  rounds: { eval_id?: string; proposal: string; critique: string }[]; }

const words = (d: number, unit: string, up = "up", down = "down"): string =>
  Math.abs(d) < 0.05 ? "no change" : `${d > 0 ? up : down} ${Math.abs(d).toFixed(1)}${unit}`;

/** Before and after rows (UI_DESIGN 3.8). Change is written as words; every number comes from the report. */
export function beforeAfter(cur: Eval, best: Eval): { measure: string; tag: string; now: string; after: string; change: string }[] {
  const pts = (best.arrival_rate - cur.arrival_rate) * 100;
  const rows = [
    { measure: "Navigability score", tag: "CALC", now: cur.score.toFixed(1), after: best.score.toFixed(1),
      change: words(best.score - cur.score, "") },
    { measure: "Arrival rate", tag: "simulated", now: `${Math.round(cur.arrival_rate * 100)}%`,
      after: `${Math.round(best.arrival_rate * 100)}%`, change: words(pts, " points") },
  ];
  if (cur.open_m !== undefined && best.open_m !== undefined)
    rows.push({ measure: "Open area to cross (m)", tag: "CALC", now: cur.open_m.toFixed(1), after: best.open_m.toFixed(1),
      change: words(best.open_m - cur.open_m, " m") });
  if (cur.turns !== undefined && best.turns !== undefined)
    rows.push({ measure: "Turns", tag: "CALC", now: String(cur.turns), after: String(best.turns),
      change: words(best.turns - cur.turns, "") });
  return rows;
}

/** R16: the floor plan needs its image and its json; say so when either is missing. */
export function floorplanNote(hasImage: boolean, hasJson: boolean): string | null {
  return hasImage && hasJson ? null : "Floor plan not available";
}

/** Split an SSE text buffer into JSON events; returns the unfinished tail. */
export function parseSse(buf: string): { events: Record<string, unknown>[]; rest: string } {
  const parts = buf.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: Record<string, unknown>[] = [];
  for (const p of parts) {
    const line = p.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* skip a torn event */ }
  }
  return { events, rest };
}

export type SortKey = "rank" | "name" | "total" | "wall_share" | "decisions" | "open_m" | "build_s";

const part = (r: PortfolioRow, k: string): number => r.parts?.[k] ?? NaN;
const val = (r: PortfolioRow, k: SortKey): number | string => {
  switch (k) {
    case "rank": return r.rank ?? Infinity;
    case "name": return r.name.toLowerCase();
    case "total": return r.total ?? -Infinity;
    case "wall_share": return part(r, "mean_wall_share");
    case "decisions": return part(r, "mean_decisions");
    case "open_m": return part(r, "open_m");
    case "build_s": return r.build_s;
  }
};

/** Scored rows only, stably sorted; NaN and missing sink to the bottom whichever way you sort. */
export function sortRows(rows: PortfolioRow[], key: SortKey, desc: boolean): PortfolioRow[] {
  const scored = rows.filter((r) => r.skipped == null && r.error == null);
  const dir = desc ? -1 : 1;
  return scored.map((r, i) => ({ r, i })).sort((a, b) => {
    const x = val(a.r, key), y = val(b.r, key);
    const bad = (v: number | string) => typeof v === "number" && !Number.isFinite(v);
    if (bad(x) !== bad(y)) return bad(x) ? 1 : -1;
    if (x < y) return -dir; if (x > y) return dir;
    return a.i - b.i;
  }).map((o) => o.r);
}

/** Rows that could not be scored, with the reason; errors (bugs) are kept apart from skips (data). */
export function unscored(rows: PortfolioRow[]): { sid: string; name: string; kind: "skipped" | "error"; why: string }[] {
  return rows.filter((r) => r.skipped != null || r.error != null).map((r) =>
    r.error != null ? { sid: r.sid, name: r.name, kind: "error" as const, why: r.error }
                    : { sid: r.sid, name: r.name, kind: "skipped" as const, why: r.skipped as string });
}

export function totalBuild(rows: PortfolioRow[]): string {
  const s = rows.reduce((a, r) => a + (r.build_s || 0), 0);
  return s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(1)} s`;
}
