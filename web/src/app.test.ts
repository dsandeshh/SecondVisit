// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { boot, focusables } from "./app";
import { fixturePkg } from "./test/fakes";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

function load() {
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>\s*$/i, "");
}

describe("index.html", () => {
  it("live regions exist at load", () => {
    load();
    expect(document.getElementById("say-polite")).not.toBeNull();
    expect(document.getElementById("say-assertive")).not.toBeNull();
    expect(document.getElementById("say-polite")!.getAttribute("aria-live")).toBe("off");
  });
  it("stage is an application with the four keys in its name", () => {
    load();
    const st = document.getElementById("stage")!;
    expect(st.getAttribute("role")).toBe("application");
    expect(st.getAttribute("tabindex")).toBe("0");
    expect(st.getAttribute("aria-label")).toMatch(/Up arrow.*left and right.*Space.*W/i);
  });
  it("every button has a name", () => {
    load();
    for (const b of Array.from(document.querySelectorAll("button")))
      expect((b.textContent ?? "").trim() || b.getAttribute("aria-label")).toBeTruthy();
  });
  it("start gate", async () => {
    load();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => fixturePkg() })));
    const app = await boot(document, new URLSearchParams("b=fixture"));
    expect(app.audio.ctx).toBeNull();
    const f = focusables(document);
    expect(f.length).toBe(1);
    expect(f[0].id).toBe("start");
    expect(document.getElementById("bname")!.textContent).toBe("Fixture lobby");
    vi.unstubAllGlobals();
  });
  it("Start goes straight in with app voice, no choice screen", async () => {
    load();
    expect(document.getElementById("mode-sr")).toBeNull();
    expect(document.getElementById("mode-app")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => fixturePkg() })));
    const app = await boot(document, new URLSearchParams("b=fixture"));
    expect(app.audio.ctx).toBeNull();
    vi.unstubAllGlobals();
  });
});
