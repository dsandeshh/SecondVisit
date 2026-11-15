import { describe, expect, it } from "vitest";
import { plan, recoveryFor, whenOf } from "./lines";

const clinic = ["You are at the drop off, on the southwest side of the building.", "Face the building. The entrance is at 1 o'clock, about 11 steps.",
  "Traffic from the street is behind you.", "Listen for cars before you cross.", "Feel for a change in the ground with your cane.",
  "You are under the canopy now. The door is straight ahead.", "Find the door handle with your hand; the door may be heavy.",
  "You are inside. Your rehearsal continues from the entrance."];

describe("arrival line timing", () => {
  it("maps every clinic line to an event", () => {
    const p = plan(clinic);
    expect(p.start).toHaveLength(3); expect(p.lane).toHaveLength(1); expect(p.edge).toHaveLength(1);
    expect(p.canopy).toHaveLength(1); expect(p.door).toHaveLength(1); expect(p.inside).toHaveLength(1);
  });
  it("other edge and door variants", () => {
    expect(whenOf("A curb ramp takes you up onto the walkway.")).toBe("edge");
    expect(whenOf("The doors slide open by themselves.")).toBe("door");
    expect(whenOf("Before the entrance you reach a lane where cars drive. Stop, listen, then cross.")).toBe("lane");
  });
  it("finds recovery lines", () => {
    const r = ["If you touch the building wall and find no door, trail the wall to your right about 3 steps to the entrance.",
      "If the traffic sound is in front of you, you are facing the road. Turn around."];
    expect(recoveryFor(r, "wall")).toBe(r[0]); expect(recoveryFor(r, "road")).toBe(r[1]); expect(recoveryFor([], "wall")).toBeNull();
  });
});
