// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { lockScroll } from "../app_v2";
import { attachKeys } from "../input/keyboard";
import { createRouter, pageFromHash, show } from "./router";
import { headline, renderScore } from "./score";

const here = dirname(fileURLToPath(import.meta.url));
const html = `<html><body data-page="home">${readFileSync(join(here, "shell_v2.html"), "utf8")}</body></html>`;
const css = readFileSync(join(here, "..", "styles", "pages.css"), "utf8");
const load = () => { document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>\s*$/i, ""); };

describe("#/inside is a locked page", () => {
  it("the CSS locks the page: 100vh, no overflow, no overscroll, no touch pan", () => {
    const rule = /body\[data-page="inside"\][^{]*\{([^}]*)\}/.exec(css)![1];
    expect(rule).toMatch(/height:\s*100vh/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/overscroll-behavior:\s*none/);
    expect(rule).toMatch(/touch-action:\s*none/);
    expect(css).toMatch(/body \{[^}]*overflow: hidden/);
  });
  it("ArrowDown and Space never scroll: default prevented anywhere on the page, scrollTop unchanged", () => {
    load();
    show(document, "inside");
    lockScroll(document);
    const stage = document.getElementById("stage")!;
    attachKeys(stage, { any: vi.fn(), step: vi.fn(), repeat: vi.fn() } as never);
    const scroller = document.scrollingElement ?? document.documentElement;
    for (const target of [stage, document.body, document.getElementById("room3d")!]) {
      for (const key of ["ArrowDown", " ", "ArrowUp", "PageDown", "End"]) {
        const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        target.dispatchEvent(e);
        expect(e.defaultPrevented, `${key} on ${target.id || "body"}`).toBe(true);
        expect(scroller.scrollTop).toBe(0);
      }
    }
  });
  it("Space still presses a focused button", () => {
    load(); show(document, "inside"); lockScroll(document);
    const e = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    document.getElementById("pause")!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
  it("the inside page carries only the pieces the brief allows", () => {
    load(); show(document, "inside");
    const visible = (id: string) => { const el = document.getElementById(id)!; return !el.closest("[hidden]"); };
    for (const id of ["stage", "ring", "miniplan", "capline", "pause", "help"]) expect(visible(id), id).toBe(true);
    expect(document.getElementById("overview")).toBeNull();
    for (const id of ["objects", "agent-run", "keys-panel", "quiz", "summary", "home", "start"]) expect(visible(id), id).toBe(false);
  });
});

describe("hash routes", () => {
  it("parses routes and shows one page at a time", () => {
    expect(pageFromHash("#/arrive")).toBe("arrive");
    expect(pageFromHash("#/nope")).toBeNull();
    load();
    for (const p of ["home", "arrive", "inside", "check", "summary", "about"] as const) {
      show(document, p);
      const shown = ["home", "rehearsal", "check", "result", "about"].filter(id => !document.getElementById(id)!.hidden);
      expect(shown.length, p).toBe(1);
      expect(document.body.dataset.page).toBe(p);
    }
  });
  it("the guard sends a visitor back to home before Start", () => {
    load();
    location.hash = "#/inside";
    const seen: string[] = [];
    const r = createRouter(window, document, () => "home", p => seen.push(p));
    expect(r.page).toBe("home");
    expect(seen).toEqual(["home"]);
    r.destroy();
  });
});

describe("score words", () => {
  it("says the score in a sentence and compares two runs", () => {
    expect(headline({ quizOk: 2, quizTotal: 3, pointDeg: 12, bumps: 0 })).toBe("2 of 3 right, pointed within 12 degrees, no bumps");
    load();
    const host = document.getElementById("score")!;
    renderScore(host, { 1: { quizOk: 1, quizTotal: 3, pointDeg: 40, bumps: 2 }, 2: { quizOk: 3, quizTotal: 3, pointDeg: 8, bumps: 0 } });
    expect(host.querySelector(".score__big")!.textContent).toBe("3 of 3 right.");
    expect(host.querySelectorAll("tbody tr").length).toBe(3);
  });
});

describe("the old flow is still the default", () => {
  it("without ?ui=v2 the v1 shell is chosen, and index.html is still the cockpit that mounts", async () => {
    const { uiVersion, DEFAULT_UI } = await import("./ui");
    expect(DEFAULT_UI).toBe("v1");
    expect(uiVersion(new URLSearchParams(""))).toBe("v1");
    expect(uiVersion(new URLSearchParams("ui=v2"))).toBe("v2");
    expect(uiVersion(new URLSearchParams("ui=v1"))).toBe("v1");
    const old = readFileSync(join(here, "..", "..", "index.html"), "utf8");
    document.documentElement.innerHTML = old.replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>\s*$/i, "");
    for (const id of ["home", "rehearsal", "stage", "room3d", "objects", "steps-list", "strip", "go", "quiz", "summary"]) expect(document.getElementById(id), id).not.toBeNull();
    const { boot, focusables } = await import("../app");
    const { fixturePkg } = await import("../test/fakes");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => fixturePkg() })));
    const app = await boot(document, new URLSearchParams("b=fixture"));
    expect(app.audio.ctx).toBeNull();
    expect(focusables(document).map(e => e.id)).toEqual(["start"]);
    vi.unstubAllGlobals();
  });
});
