import { describe, expect, it } from "vitest";
import { ARRIVE_M, CANE_M, GRID_RES, STEP_M, WALL_TRAIL_M } from "./config";

describe("config", () => {
  it("has the rule 4 constants", () => {
    expect([STEP_M, CANE_M, GRID_RES, WALL_TRAIL_M, ARRIVE_M]).toEqual([0.7, 1.2, 0.1, 0.6, 1.5]);
  });
});
