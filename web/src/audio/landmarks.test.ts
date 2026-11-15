import { describe, expect, it } from "vitest";
import type { Landmark } from "../types";
import { audible } from "./landmarks";

const lm = (id: string, kind: Landmark["kind"], x: number): Landmark =>
  ({ id, kind, label: id, pos: [x, 0], confidence: 1, fixed: true });

describe("audible", () => {
  it("audible budget", () => {
    const lms = [5, 1, 4, 2, 3, 5.5, 2.5, 1.5].map((x, i) => lm(`l${i}`, i % 2 ? "elevator" : "water", x));
    const out = audible(lms, [0, 0], 0, { max: 2, radiusM: 6, includeDestination: true });
    expect(out.map(l => l.id)).toEqual(["l1", "l7"]);
  });
  it("excludes the destination and silent kinds", () => {
    const lms = [lm("dest", "desk", 1), lm("p", "pillar", 0.5), lm("w", "water", 3), lm("far", "elevator", 7)];
    const out = audible(lms, [0, 0], 0, { max: 2, radiusM: 6, includeDestination: false, destinationId: "dest" });
    expect(out.map(l => l.id)).toEqual(["w"]);
  });
});
