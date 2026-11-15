// Where the visitor faces at the curb: the building, perpendicular to the facade. That is the entrance heading
// (plan frame, the walking-in direction), the same reference the engine's arrival script uses for its clock hour,
// so "The entrance is at 1 o'clock" is true at the first frame (clinic: the door is 17 degrees right, one turn).
import type { BuildingPackage } from "../../types";

export function startHeading(pkg: BuildingPackage): number {
  const h = pkg.entrances[0]?.heading_deg;
  return typeof h === "number" && Number.isFinite(h) ? ((h % 360) + 360) % 360 : 270;
}
