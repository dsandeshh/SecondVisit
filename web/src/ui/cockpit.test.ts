import { describe, expect, it } from "vitest";
import { fixturePkg } from "../test/fakes";
import { stepsToGo, traceLine } from "./cockpit";

describe("cockpit helpers", () => {
  it("steps to go counts the rest of this stretch plus later stretches, from the package", () => {
    const pkg = fixturePkg();
    const segs = pkg.routes[0].segments;
    const total = segs.reduce((a, s) => a + s.steps, 0);
    expect(stepsToGo(pkg, 0, segs[0].start)).toBe(total);
    expect(stepsToGo(pkg, segs.length - 1, segs[segs.length - 1].end)).toBe(0);
  });
  it("trace lines name the agent and tool", () => {
    expect(traceLine({ type: "tool_call", agent: "route_planner", tool: "plan_route" })).toBe("route_planner calls plan_route");
    expect(traceLine({ type: "thought" })).toBeNull();
  });
});
