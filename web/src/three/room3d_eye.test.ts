// @vitest-environment jsdom
// First person on the scan mesh (the #/inside fallback when the photo view is not there): eye height, at the walker,
// facing the walker's heading; the walker's own capsule is hidden.
import { describe, expect, it, vi } from "vitest";
import { fixturePkg } from "../test/fakes";

vi.mock("three", async orig => {
  const t = await orig<typeof import("three")>();
  class WebGLRenderer {
    domElement = document.createElement("canvas"); shadowMap = { enabled: false, type: 0 };
    setPixelRatio() {} setSize() {} render() {} dispose() {}
  }
  return { ...t, WebGLRenderer };
});
// label sprites draw text on a 2D canvas: any call or property is fine here
const ctx2d: any = new Proxy(function () {}, { get: (_t, k) => k === "measureText" ? () => ({ width: 10 }) : ctx2d, set: () => true, apply: () => ctx2d });
HTMLCanvasElement.prototype.getContext = (() => ctx2d) as never;
const { EYE_M, eyePose, Room3D } = await import("./room3d");

describe("first person eye pose", () => {
  it("sits at eye height on the walker and looks along the heading (plan +y is three -z)", () => {
    const p = eyePose([2, 3], 0);
    expect(EYE_M).toBe(1.5);
    expect(p.cam).toEqual([2, 1.5, -3]);
    expect(p.look[0]).toBeCloseTo(2); expect(p.look[2]).toBeLessThan(-3);   // north, ahead
    expect(p.look[1]).toBeLessThan(1.5); expect(p.look[1]).toBeGreaterThan(1);   // a little down, never at the floor
  });
  it("heading 90 looks east (+x), heading 180 south", () => {
    const e = eyePose([0, 0], 90), s = eyePose([0, 0], 180);
    expect(e.look[0]).toBeGreaterThan(0); expect(e.look[2]).toBeCloseTo(0);
    expect(s.look[2]).toBeGreaterThan(0); expect(s.look[0]).toBeCloseTo(0);
  });
  it("is never behind or above the walker", () => {
    for (const h of [0, 45, 133, 270]) {
      const p = eyePose([1, -4], h);
      expect(p.cam[0]).toBe(1); expect(p.cam[2]).toBe(4); expect(p.cam[1]).toBe(EYE_M);
    }
  });
});

describe("Room3D eye view", () => {
  it("hides the walker capsule in eye view and shows it again in the other views", () => {
    const host = document.createElement("div"); document.body.append(host);
    const r = new Room3D(host, fixturePkg(), { reducedMotion: true, compact: true });
    expect(r.walkerVisible).toBe(true);
    r.setPose([1, 2], 90, 0);
    r.setView("eye");   // reduced motion: the camera cuts at once
    expect(r.walkerVisible).toBe(false);
    expect(r.camera.position.x).toBeCloseTo(1); expect(r.camera.position.y).toBeCloseTo(EYE_M); expect(r.camera.position.z).toBeCloseTo(-2);
    r.setView("behind");
    expect(r.walkerVisible).toBe(true);
    r.dispose();
  });
  it("can start in eye view", () => {
    const host = document.createElement("div"); document.body.append(host);
    const r = new Room3D(host, fixturePkg(), { reducedMotion: true, compact: true, view: "eye" });
    expect(r.view).toBe("eye"); expect(r.walkerVisible).toBe(false);
    r.dispose();
  });
});
