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
  it("F6 leaves the stage and cycles the parts of the inside page; Shift+F6 goes back", () => {
    page("index.html");
    document.body.dataset.page = "inside";
    const stage = document.getElementById("stage")!;
    stage.dataset.view = "first";
    const speech = { say: vi.fn(), stop: vi.fn() } as never;
    const off = wireRegions(document, stage, speech, {} as never);
    stage.focus();
    const f6 = (shiftKey = false) => document.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", shiftKey, bubbles: true }));
    f6(); expect(document.activeElement).toBe(document.getElementById("pause"));
    f6(); expect(document.activeElement).toBe(document.getElementById("overview"));
    f6(); expect(document.activeElement).toBe(stage);
    f6(true); expect(document.activeElement).toBe(document.getElementById("overview"));
    off();
  });
  it("F6 on the about page reaches the objects, Keys and Agent and data", () => {
    page("index.html");
    document.body.dataset.page = "about";
    const stage = document.getElementById("stage")!;
    const off = wireRegions(document, stage, { say: vi.fn(), stop: vi.fn() } as never, {} as never);
    const f6 = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "F6", bubbles: true }));
    document.getElementById("about-h")!.tabIndex = -1; document.getElementById("about-h")!.focus();
    const seen: Element[] = [];
    for (let i = 0; i < 6; i++) { f6(); seen.push(document.activeElement!); }
    off();
    expect(seen).toContain(document.querySelector("#keys-panel > summary"));
    expect(seen).toContain(document.querySelector("#data-panel > summary"));
    expect(seen).toContain(document.querySelector(".objects__scroll"));
  });
});

describe("3D view buttons inside the stage", () => {
  it("keep Tab and Space (the stage keys ignore them) and Escape returns to the stage", async () => {
    page("index.html");
    const { attachKeys } = await import("./input/keyboard");
    const stage = document.getElementById("stage")!;
    const any = vi.fn(), enter = vi.fn(), escape = vi.fn();
    attachKeys(stage, { any, enter, escape } as never);
    const btn = document.querySelector<HTMLButtonElement>('[data-view="top"]')!;
    btn.focus();
    const fire = (key: string) => { const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }); btn.dispatchEvent(e); return e; };
    expect(fire("Tab").defaultPrevented).toBe(false);
    expect(fire(" ").defaultPrevented).toBe(false);
    fire("Enter");
    expect(any).not.toHaveBeenCalled(); expect(enter).not.toHaveBeenCalled();
    fire("Escape");
    expect(document.activeElement).toBe(stage); expect(escape).not.toHaveBeenCalled();
  });
});
