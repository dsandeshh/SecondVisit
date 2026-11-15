// Outdoor hook: Home -> fly in from the sky -> walk from the curb to the door. Called by web/src/flow.ts (runFlow)
// after the home submit and before the interior starts.
//
// CONTRACT
//   startOutdoor(o: {
//     pkg: BuildingPackage;                 // needs pkg.arrival (curb_plan, door_plan, ortho, building_outline_plan, lines ...)
//     stage: HTMLElement;                   // #stage: an overlay is added inside it and removed after the walk
//     say: (text, pri?) => void;            // speech.say; arrival lines (package.arrival.lines / recovery) go through it
//     bus: CueBus;                          // speech.bus: only read, to caption what is said
//     onInside: () => void;                 // called ONCE, when the walker is through the door; the interior starts then
//     audio?: AudioEngine;                  // OPTIONAL but needed for sound: traffic bed, door beacon, canopy, edge clicks.
//                                           // Without it the walk is silent apart from speech. (flow.ts does not pass it
//                                           // yet: add `audio` to its call; in dev `window.__sv.audio` is used as a fallback.)
//     reducedMotion?: boolean;              // default: prefers-reduced-motion. Camera moves become cuts.
//     skipFlyIn?: boolean; autoWalk?: boolean;   // dev and screenshots
//   }): Promise<{ curbPlan: Vec2; doorPlan: Vec2; onInside: () => void; stop(): void; done: Promise<void>; ctl: OutdoorController }>
//
//   curbPlan / doorPlan: plan metres (agent6 4.1.1 frame). `onInside` on the handle is the same callback (flow.ts may
//   overwrite it, which is fine: the hook calls the one it was given). `stop()` ends the walk early and removes the
//   overlay without calling onInside. `done` resolves when the walker is inside.
// Keys while outdoors (captured on window, interior keys untouched): Up step, Left/Right turn, Space repeat, B door
// sound, any key skips the fly in. When there is no arrival (a building with no pins) it throws and flow.ts falls
// back to the interior.
import { OutdoorController, type ControllerOpts } from "./three/outdoor/controller";
import type { Vec2 } from "./types";

export type StartOutdoorOpts = Omit<ControllerOpts, "audio"> & { audio?: ControllerOpts["audio"] };
export type OutdoorHandle = { curbPlan: Vec2; doorPlan: Vec2; onInside: () => void; stop(): void; done: Promise<void>; ctl: OutdoorController };

export async function startOutdoor(o: StartOutdoorOpts): Promise<OutdoorHandle> {
  const a = o.pkg.arrival;
  if (!a || !(a.curb_plan ?? a.dropoff_plan) || !(a.door_plan ?? o.pkg.entrances[0])) throw new Error("no curb to door walk for this building");
  const audio = o.audio ?? ((globalThis as any).__sv?.audio ?? null);
  const ctl = new OutdoorController({ ...o, audio });
  ctl.start();
  return {
    curbPlan: ctl.curb, doorPlan: ctl.door, onInside: o.onInside ?? (() => {}), stop: () => ctl.dispose(), done: ctl.done, ctl,
  };
}
