// Stream 1's first person photo view, loaded only if the file is there (the build never breaks while it is absent).
// Contract: mountShowcase({ host, pkg, world, bus, say, onReady, onFail }) => Promise<ShowcaseHandle>.
import type { CueBus } from "../events";
import type { BuildingPackage, Vec2 } from "../types";
import type { World } from "../world";

export interface ShowcaseHandle { setPose(planPos: Vec2, headingDeg: number): void; stop(): void; calibration?: unknown; ready: boolean }
export interface ShowcaseOpts {
  host: HTMLElement; pkg: BuildingPackage; world: World; bus: CueBus; say: (text: string, pri?: 1 | 2 | 3) => void;
  onReady: () => void; onFail: (why?: unknown) => void; safeTop?: number; safeBottom?: number;
}
export interface ShowcaseModule { mountShowcase(o: ShowcaseOpts): Promise<ShowcaseHandle> }

export async function loadShowcase(): Promise<ShowcaseModule | null> {
  try {
    const mods = import.meta.glob(["../showcase/*.ts", "!../showcase/*.test.ts"]);
    for (const load of Object.values(mods)) {
      const m = (await load()) as Partial<ShowcaseModule>;
      if (typeof m.mountShowcase === "function") return m as ShowcaseModule;
    }
    return null;
  } catch { return null; }
}
