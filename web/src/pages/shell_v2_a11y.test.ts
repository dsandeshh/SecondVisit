// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { wireRegions } from "../app_v2";

const dir = dirname(fileURLToPath(import.meta.url));
const page = (_f: string) => {
  document.documentElement.innerHTML = `<body data-page="home">${readFileSync(join(dir, "shell_v2.html"), "utf8")}</body>`;
};
describe("v2 shell stage", () => {
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

