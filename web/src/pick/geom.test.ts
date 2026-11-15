import { describe, expect, it } from "vitest";
import { buildOverrides, calibrateYaw0, faceBearing, headingFromDrag, planToPx, pxToPlan } from "./geom";

const fp = { width: 4366, height: 1532, resolution: 100, origin: [-30.817, -12.9795] as [number, number] };

describe("pick geometry", () => {
  it("places the floor plan by origin and resolution, image y down", () => {
    expect(planToPx(fp, [-30.817, -12.9795])).toEqual([0, 1532]);
    const [x, y] = planToPx(fp, [-1.79, -5.52]);
    const back = pxToPlan(fp, [x, y]);
    expect(back[0]).toBeCloseTo(-1.79, 6);
    expect(back[1]).toBeCloseTo(-5.52, 6);
    expect(pxToPlan(fp, [0, 0])[1]).toBeCloseTo(-12.9795 + 15.32, 6);
  });

  it("drag heading is 0 for +y and clockwise", () => {
    expect(headingFromDrag([0, 0], [0, 1])).toBeCloseTo(0);
    expect(headingFromDrag([0, 0], [1, 0])).toBeCloseTo(90);
    expect(headingFromDrag([0, 0], [-1, 0])).toBeCloseTo(270);
  });

  it("face bearing and calibration match the engine", () => {
    expect(faceBearing(1, 2048, 2048, 0, true)).toBeCloseTo(45);
    expect(faceBearing(2, 1024, 2048, 0, false)).toBeCloseTo(270);
    const yaw0 = calibrateYaw0([0, 0], 3, 1024, 2048, [1, 1], true);
    expect(faceBearing(3, 1024, 2048, yaw0, true)).toBeCloseTo(45);
  });

  it("exports the R5 overrides schema", () => {
    const o = buildOverrides({
      entrance: { pos: [1.234, 2], heading_deg: 90.04 },
      destination: { pos: [3, 4], label: "Reception desk" },
      extra: [{ kind: "door", label: "Door", pos: [5, 6] }],
      deleted: ["sign_2"], yaw0: 12.345, clockwise: true, arrival: null,
    });
    expect(o).toEqual({
      entrance: { id: "ent_main", label: "Entrance", pos: [1.23, 2], heading_deg: 90 },
      destination: { pos: [3, 4], label: "Reception desk" },
      extra_landmarks: [{ id: "hand_1", kind: "door", label: "Door", pos: [5, 6], confidence: 1, fixed: true }],
      deleted_landmark_ids: ["sign_2"], face_yaw0_deg: 12.3, faces_clockwise: true, arrival: null,
    });
  });
});
