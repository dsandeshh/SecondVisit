// @vitest-environment jsdom
// docs/UI_DESIGN.md section 6: static accessibility checks on the four entry pages.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { wireRegions } from "./app";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = (f: string) => {
  document.documentElement.innerHTML = readFileSync(join(dir, f), "utf8").replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>\s*$/i, "");
};
const name = (e: Element) => (e.getAttribute("aria-label") ?? "").trim() || (e.textContent ?? "").trim()
  || ((e as HTMLElement).id && document.querySelector(`label[for="${(e as HTMLElement).id}"]`)?.textContent?.trim()) || e.closest("label")?.textContent?.trim();

describe.each(["index.html", "observer.html", "venue.html", "pick.html"])("%s", f => {
  it("has lang, title, a skip link and a main landmark", () => {
    page(f);
    expect(readFileSync(join(dir, f), "utf8")).toMatch(/<html lang="en"/);
    expect(document.title).toMatch(/SecondVisit/);
    // index.html has no skip link on purpose: Start must be the first Tab stop and the top bar is hidden until the rehearsal.
    if (f !== "index.html") expect(document.querySelector('a.skip-link[href="#main"]')).not.toBeNull();
    expect(document.querySelector("main#main, #main")).not.toBeNull();
  });
  it("every button, input, select and tab has a text name", () => {
    page(f);
    for (const e of Array.from(document.querySelectorAll("button, input:not([type=hidden]), select, textarea, [role=tab]")))
      expect(name(e), (e as HTMLElement).outerHTML.slice(0, 80)).toBeTruthy();
  });
  it("every canvas is named or hidden, and images have alt", () => {
    page(f);
    for (const c of Array.from(document.querySelectorAll("canvas")))
      expect(c.getAttribute("aria-hidden") === "true" || (c.getAttribute("role") === "img" && !!c.getAttribute("aria-label"))
, c.outerHTML).toBe(true);
    for (const i of Array.from(document.querySelectorAll("img"))) expect(i.hasAttribute("alt")).toBe(true);
  });
  it("no tabindex above 0 and no live region that speaks over our voice", () => {
    page(f);
    for (const e of Array.from(document.querySelectorAll("[tabindex]"))) expect(Number(e.getAttribute("tabindex"))).toBeLessThanOrEqual(0 + 0);
    for (const e of Array.from(document.querySelectorAll("#say-polite, #say-assertive, #caption, #agent-log, #trace")))
      expect(e.getAttribute("aria-live")).toBe("off");
  });
});

describe("index.html stage", () => {
  it("3D view and intro prompt are aria-hidden; stage is role application", () => {
    page("index.html");
    expect(document.getElementById("room3d")!.getAttribute("aria-hidden")).toBe("true");
    expect(document.getElementById("intro-prompt")!.getAttribute("aria-hidden")).toBe("true");
    expect(document.getElementById("miniplan")!.getAttribute("aria-hidden")).toBe("true");
    expect(document.getElementById("stage")!.getAttribute("role")).toBe("application");
  });
  it("F6 leaves the stage and cycles regions; Shift+F6 goes back", () => {
    page("index.html");
    const stage = document.getElementById("stage")!;
    const speech = { say: vi.fn(), stop: vi.fn() } as never;
    wireRegions(document, stage, speech, {} as never);
    stage.focus();
    const f6 = (shiftKey = false) => document.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", shiftKey, bubbles: true }));
    f6(); expect(document.activeElement).toBe(document.querySelector(".objects__scroll"));
    f6(); expect(document.activeElement).toBe(document.querySelector("#keys-panel > summary"));
    f6(); expect(document.activeElement).toBe(document.querySelector("#data-panel > summary"));
    f6(true); expect(document.activeElement).toBe(document.querySelector("#keys-panel > summary"));
    f6(true); f6(true); expect(document.activeElement).toBe(stage);
  });
});
