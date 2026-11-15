// Step 6 wiring: Home -> fly in -> curb walk -> interior, behind ?flow=full (default stays interior first).
//
// Hook contract (stream 1 writes web/src/outdoor_hook.ts; this file never imports it statically, so the build
// works while the file is absent):
//
//   export function startOutdoor(o: {
//     pkg: BuildingPackage;          // the loaded package (entrances[0] is where the interior starts)
//     stage: HTMLElement;            // #stage, the application region; draw into it, own the keys while outdoors
//     say: (text: string, pri?: 1 | 2 | 3) => void;   // speech.say, always spoken and captioned
//     bus: CueBus;                   // speech.bus, the one event bus (captions, sound ring, observer)
//     onInside: () => void;          // call ONCE when the walker is through the door; the interior starts then
//   }): void | { stop?(): void; onInside?: () => void } | Promise<same>;
//
// If the returned handle has an `onInside` property it is also set (either style works).
// The caption strip, sound ring and top bar stay visible and keep running during the outdoor part.
import type { CueBus } from "./events";
import type { BuildingPackage } from "./types";

export interface OutdoorOpts {
  pkg: BuildingPackage; stage: HTMLElement; say: (text: string, pri?: 1 | 2 | 3) => void; bus: CueBus; onInside: () => void; audio?: unknown;
}
export interface OutdoorModule { startOutdoor(o: OutdoorOpts): unknown }

export const fullFlow = (params: URLSearchParams): boolean => params.get("flow") === "full";

/** The hook module if the file exists (import.meta.glob is empty when it does not, so the build never breaks). */
export async function loadOutdoorHook(): Promise<OutdoorModule | null> {
  try {
    const mods = import.meta.glob("./outdoor_hook.ts");
    const load = mods["./outdoor_hook.ts"];
    if (!load) return null;
    const m = (await load()) as Partial<OutdoorModule>;
    return typeof m.startOutdoor === "function" ? (m as OutdoorModule) : null;
  } catch { return null; }
}

/**
 * Run the outdoor part when a hook is there, then `begin()` the interior. Returns "outdoor" when the outdoor
 * part took over (begin runs later, from onInside), "interior" when begin ran at once (no hook, or it threw).
 */
export async function runFlow(o: { hook: OutdoorModule | null; pkg: BuildingPackage; stage: HTMLElement; say: OutdoorOpts["say"]; bus: CueBus; audio?: unknown; begin: () => void; onOutdoor?: (on: boolean) => void }): Promise<"outdoor" | "interior"> {
  if (!o.hook) { o.begin(); return "interior"; }
  let inside = false;
  // begin() is guarded here too: an error starting the interior is logged, never thrown into the outdoor walk.
  const begin = () => { try { o.begin(); } catch (e) { console.error("SecondVisit: starting the interior failed", e); } };
  const onInside = () => { if (inside) return; inside = true; o.onOutdoor?.(false); begin(); };
  try {
    o.onOutdoor?.(true);
    const h: any = await o.hook.startOutdoor({ pkg: o.pkg, stage: o.stage, say: o.say, bus: o.bus, audio: o.audio, onInside });
    if (h && typeof h === "object" && "onInside" in h) h.onInside = onInside;
    return "outdoor";
  } catch (e) {
    console.error("SecondVisit: the outdoor walk could not start; going inside", e);
    o.onOutdoor?.(false);
    if (!inside) { inside = true; begin(); }
    return "interior";
  }
}
