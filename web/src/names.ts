// Spoken names (CHANGELOG: Landmark.spoken). The short sentence case name is what is said and drawn; the full label
// stays in the package. No confidence word is ever spoken or shown (human decision 15 Nov): low confidence appears
// only as the AI chip value ("AI 0.42") where chips are shown. How a line is spoken never changes with confidence.
import type { Landmark } from "./types";

export const POSSIBLE_BELOW = 0.6;
export const spokenOf = (l: Pick<Landmark, "spoken" | "label">): string => (l.spoken?.trim() || l.label.trim());
/** Low confidence (under 0.6): drives the AI chip colour only, never the words. */
export const isLowConfidence = (l: Pick<Landmark, "confidence">): boolean => l.confidence < POSSIBLE_BELOW;
/** Whole name in lower case, as the engine's "Passing the {spoken.lower()}." templates do. */
export const spokenLower = (l: Pick<Landmark, "spoken" | "label">): string => spokenOf(l).toLowerCase();
