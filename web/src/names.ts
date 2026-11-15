// Spoken names (CHANGELOG: Landmark.spoken). The short sentence case name is what is said and drawn; the full label
// stays in the package. "possibly" is never part of the name: it is a separate prefix word under 0.6 confidence.
import type { Landmark } from "./types";

export const POSSIBLE_BELOW = 0.6;
export const spokenOf = (l: Pick<Landmark, "spoken" | "label">): string => (l.spoken?.trim() || l.label.trim());
export const isPossibly = (l: Pick<Landmark, "confidence">): boolean => l.confidence < POSSIBLE_BELOW;
/** Prefix option for Speech.say: {prefix:"possibly"} when the label is unsure. */
export const possiblyOpts = (l: Pick<Landmark, "confidence">): { prefix?: string } => (isPossibly(l) ? { prefix: "possibly" } : {});
/** Whole name in lower case, as the engine's "Passing the {spoken.lower()}." templates do. */
export const spokenLower = (l: Pick<Landmark, "spoken" | "label">): string => spokenOf(l).toLowerCase();
/** For text drawn on screen (objects list, 3D labels): "possibly " as a separate word, then the short name. */
export const shownName = (l: Pick<Landmark, "spoken" | "label" | "confidence">): string =>
  (isPossibly(l) ? "possibly " : "") + (isPossibly(l) ? spokenOf(l).charAt(0).toLowerCase() + spokenOf(l).slice(1) : spokenOf(l));
