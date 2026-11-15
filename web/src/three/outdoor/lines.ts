// Which event each spoken arrival line belongs to. The lines themselves come from package.arrival (computed by the
// engine, grounded, pre-rendered); this only decides WHEN each is said. No literals are spoken from here.
export type LineWhen = "start" | "lane" | "edge" | "canopy" | "door" | "inside";

export function whenOf(text: string): LineWhen {
  const t = text.toLowerCase();
  if (/^you are inside/.test(t)) return "inside";
  if (/under the canopy/.test(t)) return "canopy";
  if (/(door handle|doors? slides?|door opens|push the door|pull the door|handle is)/.test(t)) return "door";
  if (/(walkway|change in the ground|curb ramp|step up)/.test(t)) return "edge";
  if (/(cars|lane where cars)/.test(t) && !/^traffic/.test(t)) return "lane";
  return "start";
}

export function plan(lines: string[]): Record<LineWhen, string[]> {
  const out: Record<LineWhen, string[]> = { start: [], lane: [], edge: [], canopy: [], door: [], inside: [] };
  for (const l of lines) out[whenOf(l)].push(l);
  return out;
}

/** Recovery line to speak after a bump into the building wall, or when walking toward the road. */
export function recoveryFor(recovery: string[], kind: "wall" | "road"): string | null {
  const re = kind === "wall" ? /touch the building wall/i : /traffic sound is in front/i;
  return recovery.find(r => re.test(r)) ?? null;
}
