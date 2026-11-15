// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fixturePkg } from "../test/fakes";
import { SummaryReader, renderSummary, summaryLines } from "./summary";

describe("pocket summary", () => {
  it("one numbered line per stretch, from the package", () => {
    const pkg = fixturePkg();
    const l = summaryLines(pkg.routes[0]);
    expect(l.length).toBe(pkg.routes[0].segments.length);
    expect(l[0]).toBe(pkg.routes[0].segments[0].instruction);
  });
  it("Space reads one instruction per utterance, then loops with a closing line", () => {
    const pkg = fixturePkg();
    const say = vi.fn();
    const r = new SummaryReader(summaryLines(pkg.routes[0]), say);
    r.next(); r.next(); r.next();
    expect(say.mock.calls.map(c => c[0])).toEqual(summaryLines(pkg.routes[0]).map((t, i) => `Stretch ${i + 1}. ${t}`));
    r.next();
    expect(say.mock.calls.at(-1)![0]).toMatch(/^End of the summary/);
  });
  it("renders an ordered list, driver message, limits note and floor plan note", () => {
    document.body.innerHTML = `<div id="c"></div>`;
    const pkg = fixturePkg();
    pkg.arrival = { lat: 0, lon: 0, entrance_side: "north", dropoff: [0, 0], driver_message: "Drop me at the north door.",
      image_url: null, confirmed: true, curb_to_door_m: null, dropoff_plan: null };
    renderSummary(document.getElementById("c")!, pkg, pkg.routes[0], { floorPlan: false });
    expect(document.querySelectorAll("#c ol > li").length).toBe(pkg.routes[0].segments.length);
    expect(document.getElementById("c")!.textContent).toContain("Drop me at the north door.");
    expect(document.getElementById("c")!.textContent).toContain("Floor plan not available");
    expect(document.getElementById("c")!.textContent).toContain("does not replace your cane");
    expect(document.querySelector("#c button")?.textContent).toBe("Copy driver message");
  });
  it("puts a source chip next to each instruction that has prov, and the layer meter", () => {
    document.body.innerHTML = `<div id="c"></div>`;
    const pkg = fixturePkg();
    const seg = pkg.routes[0].segments[0];
    pkg.prov = { [`segment:${seg.id}.steps`]: { src: "calc", ref: "plan", at: "2026-11-14T21:42:00+00:00", inputs: [] } };
    renderSummary(document.getElementById("c")!, pkg, pkg.routes[0], { floorPlan: false });
    expect(document.querySelector("#c ol > li .chip")!.textContent).toBe("CALC");
    expect(document.querySelector("#c .layer-meter")).not.toBeNull();
  });
});
