// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fixturePkg } from "../test/fakes";
import type { Prov } from "../types";
import { chip, chipText, describeProv, isLowConfidence, layerCounts, renderLayerMeter, sourceLine } from "./prov";

const P = (src: Prov["src"], extra: Partial<Prov> = {}): Prov => ({ src, ref: "r", at: "2026-11-14T21:42:00+00:00", ...extra });

describe("provenance chips", () => {
  it("text carries the kind, AI shows confidence", () => {
    expect(chipText(P("matterport"))).toBe("MP");
    expect(chipText(P("hand"))).toBe("HAND");
    expect(chipText(P("ai", { confidence: 0.72 }))).toBe("AI 0.72");
  });
  it("AI under 0.6 shows only its confidence value, never the word possibly", () => {
    const lo = P("ai", { confidence: 0.4 });
    expect(isLowConfidence(lo)).toBe(true);
    expect(isLowConfidence(P("ai", { confidence: 0.6 }))).toBe(false);
    expect(chipText(lo)).toBe("AI 0.40");
    expect(describeProv(lo)).toBe("Source: labelled by AI, confidence 0.40");
  });
  it("CALC lists its input sources", () => {
    const prov = { "grid": P("matterport"), "landmark:desk": P("ai", { confidence: 0.8 }) };
    expect(describeProv(P("calc", { inputs: ["grid", "landmark:desk"] }), prov)).toBe("Source: computed from Matterport scan and labelled by AI");
  });
  it("chip button has text, aria-label, toggles details and Escape closes", () => {
    document.body.innerHTML = "";
    const { button, details } = chip(document, "landmark:desk", P("ai", { confidence: 0.4 }));
    document.body.append(button, details);
    expect(button.textContent).toBe("AI 0.40");
    expect(button.getAttribute("aria-label")).not.toMatch(/possibly/i);
    expect(button.className).toContain("chip--low");
    expect(details.hidden).toBe(true);
    button.click();
    expect(details.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(details.textContent).toContain("landmark:desk");
    details.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(details.hidden).toBe(true);
  });
  it("layer meter counts match prov", () => {
    const pkg = fixturePkg();
    pkg.prov = { a: P("matterport"), b: P("matterport"), c: P("vexcel"), d: P("calc"), e: P("hand"), f: P("ai", { confidence: 0.9 }) };
    expect(layerCounts(pkg.prov)).toEqual({ MP: 2, VX: 1, CS: 0, AI: 1, CALC: 1, HAND: 1 });
    document.body.innerHTML = `<div id="m"></div>`;
    renderLayerMeter(document.getElementById("m")!, pkg);
    const cells = [...document.querySelectorAll("#m dl > div")].map(c => c.textContent);
    expect(cells).toContain("MP2");
    expect(cells).toContain("HAND1");
    expect(document.querySelector(".layer-meter__bar")!.getAttribute("aria-hidden")).toBe("true");
  });
  it("meter is hidden when there is no prov", () => {
    const pkg = fixturePkg(); pkg.prov = {};
    document.body.innerHTML = `<div id="m"></div>`;
    renderLayerMeter(document.getElementById("m")!, pkg);
    expect(document.getElementById("m")!.hidden).toBe(true);
  });
  it("S line speaks the source of the current instruction", () => {
    const pkg = fixturePkg();
    const seg = pkg.routes[0].segments[0];
    pkg.prov = { [`segment:${seg.id}.steps`]: P("calc", { inputs: ["grid"] }), grid: P("matterport") };
    expect(sourceLine(pkg, pkg.routes[0], 0)).toBe("Source: computed from Matterport scan.");
    pkg.prov = {};
    expect(sourceLine(pkg, pkg.routes[0], 0)).toMatch(/No source recorded/);
  });
});
