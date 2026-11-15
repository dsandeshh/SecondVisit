// @vitest-environment jsdom
// Product decision (15 Nov, 05:12): the offline scan mesh is the view inside, from the first frame, and never changes on
// its own. Matterport (the photo view) is mounted only when the visitor presses V; V again returns to the scan.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boot, PHOTO_OFF_LINE, PHOTO_ON_LINE } from "../app_v2";
import { fixturePkg, FakeAudioContext } from "../test/fakes";
import { FALLBACK_LINE } from "../showcase/load";
import type { ShowcaseHandle, ShowcaseOpts } from "./showcase_hook";

const sc = vi.hoisted(() => ({
  online: true,
  stops: 0,
  mountShowcase: null as unknown as ReturnType<typeof vi.fn>,
  load: null as unknown as ReturnType<typeof vi.fn>,
}));
// Network unblocked: the SDK connects and calls onReady. Blocked: the module speaks the fallback and calls onFail.
sc.mountShowcase = vi.fn(async (o: ShowcaseOpts): Promise<ShowcaseHandle> => {
  const frame = document.createElement("iframe"); o.host.prepend(frame);
  if (!sc.online) { frame.remove(); o.say(FALLBACK_LINE); o.onFail("offline"); return { setPose: () => undefined, stop: () => undefined, ready: false }; }
  await new Promise(r => setTimeout(r, 5));
  o.onReady();
  return { setPose: () => undefined, stop: () => { sc.stops++; frame.remove(); }, ready: true };
});
sc.load = vi.fn(async () => ({ mountShowcase: sc.mountShowcase }));
vi.mock("./showcase_hook", () => ({ loadShowcase: () => sc.load() }));
// The full flow: the outdoor walk hands over to the interior on the next tick.
vi.mock("../flow", async (orig) => ({
  ...(await orig<typeof import("../flow")>()),
  loadOutdoorHook: async () => ({ startOutdoor: (o: { onInside: () => void }) => { setTimeout(() => o.onInside(), 0); return {}; } }),
}));

const html = `<html><body data-page="home">${readFileSync(join(dirname(fileURLToPath(import.meta.url)), "shell_v2.html"), "utf8")}</body></html>`;
const load = () => { document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>\s*$/i, ""); };
const $ = (id: string) => document.getElementById(id)!;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const press = (key: string) => $("stage").dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

async function enter(q: string, online: boolean) {
  sc.online = online; sc.stops = 0; sc.mountShowcase.mockClear(); sc.load.mockClear();
  window.location.hash = "#/home";
  await wait(0);
  load();
  try { localStorage.setItem("sv.keycard.seen", "1"); } catch { /* */ }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  const fetchMock = vi.fn(async (u: string) => /package\.json/.test(String(u)) ? ({ ok: true, json: async () => fixturePkg() }) : ({ ok: false, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
  const app = await boot(document, new URLSearchParams(q));
  const spoken: string[] = [];
  const orig = app.speech.say.bind(app.speech);
  app.speech.say = (t: string, p?: 1 | 2 | 3) => { spoken.push(t); return orig(t, p); };
  $("start").click();
  await vi.waitFor(() => expect(document.body.dataset.page).toBe("inside"));
  if (document.getElementById("keycard")?.hidden === false) press("Escape");   // the first visit key card swallows one key
  return { app, spoken, fetchMock };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("#/inside: the scan mesh is the default view, Matterport only on V", () => {
  for (const q of ["b=fixture&flow=interior", "b=fixture"]) for (const online of [true, false]) {
    it(`${q.includes("interior") ? "flow=interior" : "full flow"}, network ${online ? "unblocked" : "blocked"}: mesh from the first frame, no showcase, no swap`, async () => {
      const { spoken, fetchMock } = await enter(q, online);
      expect($("stage").dataset.view).toBe("mesh");
      for (let i = 0; i < 6; i++) { await wait(60); expect($("stage").dataset.view).toBe("mesh"); }
      expect(sc.load).not.toHaveBeenCalled();
      expect(sc.mountShowcase).not.toHaveBeenCalled();
      expect($("showcase").hidden).toBe(true);
      expect($("showcase").querySelector("iframe")).toBeNull();
      expect($("photo-note").hidden).toBe(true);
      expect(spoken).not.toContain(FALLBACK_LINE);
      expect(fetchMock.mock.calls.some(([u]) => /matterport/i.test(String(u)))).toBe(false);
    });
  }

  it("V mounts the photo view, V again returns to the mesh, repeatedly, with one mount and one iframe", async () => {
    const { spoken } = await enter("b=fixture&flow=interior", true);
    press("v");
    expect(spoken).toContain(PHOTO_ON_LINE);
    await vi.waitFor(() => expect($("stage").dataset.view).toBe("first"));
    expect(sc.mountShowcase).toHaveBeenCalledTimes(1);
    expect($("showcase").hidden).toBe(false);
    press("v");
    expect($("stage").dataset.view).toBe("mesh");
    expect(spoken).toContain(PHOTO_OFF_LINE);
    for (let i = 0; i < 3; i++) {
      press("v"); await vi.waitFor(() => expect($("stage").dataset.view).toBe("first"));
      press("v"); expect($("stage").dataset.view).toBe("mesh");
    }
    expect(sc.mountShowcase).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("#showcase iframe").length).toBe(1);
    expect($("photo-note").hidden).toBe(true);
    expect(spoken).not.toContain(FALLBACK_LINE);
  });

  it("the fallback note appears only when the chosen photo view fails, and V tries again", async () => {
    const { spoken } = await enter("b=fixture&flow=interior", false);
    expect($("photo-note").hidden).toBe(true);
    press("v");
    await vi.waitFor(() => expect($("photo-note").hidden).toBe(false));
    expect($("photo-note").textContent).toBe(FALLBACK_LINE);
    expect(spoken).toContain(FALLBACK_LINE);
    expect($("stage").dataset.view).toBe("mesh");
    expect(document.querySelectorAll("#showcase iframe").length).toBe(0);
    sc.online = true;
    press("v");
    await vi.waitFor(() => expect($("stage").dataset.view).toBe("first"));
    expect($("photo-note").hidden).toBe(true);
    expect(sc.mountShowcase).toHaveBeenCalledTimes(2);
  });

  it("V back to the scan while the photo view is still loading: it never swaps in on its own", async () => {
    await enter("b=fixture&flow=interior", true);
    press("v"); press("v");
    await wait(50);
    expect($("stage").dataset.view).toBe("mesh");
  });
});
