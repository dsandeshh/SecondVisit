// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { boot, focusables } from "../app_v2";
import { fixturePkg, FakeAudioContext } from "../test/fakes";
import { FALLBACK_LINE } from "../showcase/load";
import type { ShowcaseHandle, ShowcaseOpts } from "./showcase_hook";

// A default that succeeds, so tests that don't care about the photo view are unaffected; the
// fallback test below overrides it once to model the module's own offline/failure contract.
const showcaseMock = vi.hoisted(() => ({
  mountShowcase: vi.fn(async (_o: ShowcaseOpts): Promise<ShowcaseHandle> =>
    ({ setPose: () => undefined, stop: () => undefined, ready: true })),
}));
vi.mock("./showcase_hook", () => ({
  loadShowcase: async () => ({ mountShowcase: showcaseMock.mountShowcase }),
}));

const html = `<html><body data-page="home">${readFileSync(join(dirname(fileURLToPath(import.meta.url)), "shell_v2.html"), "utf8")}</body></html>`;

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
    expect(f[0].id).toBe("start");   // Start is the first Tab stop; the address box and the building buttons follow
    expect(f.map(e => e.id || e.tagName).slice(0, 2)).toEqual(["start", "addr"]);
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
  it("#/inside has no Overview toggle: no third person view to choose", () => {
    load();
    expect(document.getElementById("overview")).toBeNull();
    for (const b of Array.from(document.querySelectorAll("button"))) expect((b.textContent ?? "").trim()).not.toBe("Overview");
  });
  it("the 3D view bar is not keyboard reachable in v2 (hidden and inert, so no tab stop)", () => {
    load();
    const bar = document.querySelector<HTMLElement>(".room3d-bar")!;
    expect(bar.hidden).toBe(true);
    expect(bar.hasAttribute("inert")).toBe(true);
    for (const b of Array.from(bar.querySelectorAll("button"))) expect(focusables(document)).not.toContain(b);
  });
  it("activating a building card starts the journey at #/arrive with that building", async () => {
    load();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", vi.fn(async (u: string) => /package\.json/.test(String(u)) ? ({ ok: true, json: async () => fixturePkg() }) : ({ ok: false, json: async () => ({}) })));
    window.location.hash = "#/home";
    const app = await boot(document, new URLSearchParams());
    const card = document.querySelector<HTMLButtonElement>('#buildings button[data-sid="fixture"]')!;
    expect(card).not.toBeNull();
    card.click();
    await vi.waitFor(() => expect(window.location.hash).toBe("#/arrive"));
    expect(app.pkg?.id).toBe(fixturePkg().id);
    expect(app.audio.ctx).not.toBeNull();
    vi.unstubAllGlobals();
  });
  it("shows the calm fallback note and keeps the rehearsal working when the photo view fails", async () => {
    load();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => fixturePkg() })));
    // The real module never rejects: on any failure it speaks the fallback line itself, then calls onFail once
    // and resolves an inert handle (web/src/showcase/index.ts). Model that contract exactly, once.
    showcaseMock.mountShowcase.mockImplementationOnce(async (o: ShowcaseOpts) => {
      o.say(FALLBACK_LINE); // the real module's own offline line, spoken before onFail
      o.onFail("offline");
      return { setPose: () => undefined, stop: () => undefined, ready: false };
    });
    const spoken: string[] = [];
    const app = await boot(document, new URLSearchParams("b=fixture&flow=interior"));
    const origSay = app.speech.say.bind(app.speech);
    app.speech.say = (t: string, p?: 1 | 2 | 3) => { spoken.push(t); return origSay(t, p); };
    document.getElementById("start")!.click();
    await vi.waitFor(() => expect(document.body.dataset.page).toBe("inside"));
    await vi.waitFor(() => expect(document.getElementById("photo-note")!.hidden).toBe(false));
    expect(document.getElementById("photo-note")!.textContent).toBe(FALLBACK_LINE);
    expect(document.getElementById("overview")).toBeNull(); // no view toggle: the fallback is first person on the mesh
    expect(document.getElementById("stage")!.dataset.view).toBe("mesh"); // never a blank view
    expect(spoken).toContain(FALLBACK_LINE); // Michael says it; it is not only printed
    vi.unstubAllGlobals();
  });
});
