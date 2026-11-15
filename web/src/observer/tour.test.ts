import { describe, expect, it } from "vitest";
import { tourDecision } from "./tour";

describe("observer shows tour only when public", () => {
  it("shows on localhost for public or unknown visibility", () => {
    for (const v of ["public", "unlisted", "PUBLIC", null, undefined]) {
      const d = tourDecision("localhost", "x37LjPx62VA", v);
      expect(d.show).toBe(true);
      if (d.show) expect(d.src).toBe("https://my.matterport.com/show/?m=x37LjPx62VA&play=1&qs=1");
    }
  });
  it("hides when private, with a note", () => {
    const d = tourDecision("localhost", "x37LjPx62VA", "private");
    expect(d).toEqual({ show: false, note: expect.stringContaining("private") });
  });
  it("hides off localhost and for the fixture", () => {
    expect(tourDecision("demo.example.com", "x37LjPx62VA", "public").show).toBe(false);
    expect(tourDecision("localhost", "fixture", "public").show).toBe(false);
  });
  it("adds the SDK key only when set", () => {
    const d = tourDecision("127.0.0.1", "x37LjPx62VA", "public", "k&1");
    expect(d.show && d.src).toContain("&applicationKey=k%261");
  });
});
