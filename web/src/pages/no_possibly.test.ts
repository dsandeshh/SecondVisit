// @vitest-environment jsdom
// Human decision 15 Nov: the word "possibly" is never spoken or shown. Low confidence shows only as the AI chip
// value ("AI 0.42"). This renders the pages with low confidence landmarks and checks every text node, caption,
// aria-label and speech.say call.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { boot } from "../app_v2";
import { renderSummary } from "../modes/summary";
import { fixturePkg, FakeAudioContext } from "../test/fakes";
import type { BuildingPackage } from "../types";

vi.mock("./showcase_hook", () => ({
  loadShowcase: async () => ({ mountShowcase: async () => ({ setPose: () => undefined, stop: () => undefined, ready: true }) }),
}));

const here = dirname(fileURLToPath(import.meta.url));
const html = `<html><body data-page="home">${readFileSync(join(here, "shell_v2.html"), "utf8")}</body></html>`;
const load = () => { document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>\s*$/i, ""); };
const BAD = /possibly/i;

function lowPkg(): BuildingPackage {
  const p = fixturePkg();
  const desk = p.landmarks[0];
  p.landmarks = [
    { ...desk, confidence: 0.42, spoken: "Reception desk" },
    { ...desk, id: "col", kind: "pillar", label: "exterior column", spoken: "Exterior column", confidence: 0.3,
      pos: [desk.pos[0] - 1, desk.pos[1] - 1] },
  ];
  p.prov = { ...p.prov, "landmark:col": { src: "ai", ref: "test", at: "2026-11-15T00:00:00+00:00", confidence: 0.3 } };
  return p;
}

function textOf(root: Node): string[] {
  const out: string[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent?.trim()) out.push(n.textContent);
  for (const el of Array.from((root as Element).querySelectorAll?.("[aria-label],[title],[alt]") ?? []))
    for (const a of ["aria-label", "title", "alt"]) { const v = el.getAttribute(a); if (v) out.push(v); }
  return out;
}

const key = (k: string) => document.getElementById("stage")!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("no 'possibly' anywhere, even for low confidence landmarks", () => {
  it("#/inside, #/about, check and summary: no text node, caption or spoken line says it", async () => {
    window.location.hash = "#/home";
    await new Promise(r => setTimeout(r, 0));
    load();
    const pkg = lowPkg();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", vi.fn(async (u: string) => /package\.json/.test(String(u))
      ? ({ ok: true, headers: { get: () => "application/json" }, json: async () => pkg })
      : ({ ok: false, headers: { get: () => "application/json" }, json: async () => ({}) })));
    const app = await boot(document, new URLSearchParams("b=fixture&flow=interior"));
    const spoken: string[] = [];
    const orig = app.speech.say.bind(app.speech);
    app.speech.say = ((t: string, p?: 0 | 1 | 2 | 3, o?: object) => { spoken.push(t + " " + JSON.stringify(o ?? {})); return orig(t, p, o); }) as typeof app.speech.say;
    const captions: string[] = [];
    const watch = () => ["say-polite", "say-assertive", "capline"].forEach(id => { const t = document.getElementById(id)?.textContent; if (t) captions.push(t); });

    document.getElementById("start")!.click();
    await vi.waitFor(() => expect(document.body.dataset.page).toBe("inside"));
    for (const k of ["Tab", "q", "e", "ArrowUp", "ArrowUp", "ArrowLeft", "ArrowUp", "Tab", "q", "e", "ArrowUp", "ArrowUp"]) {
      key(k); watch(); await new Promise(r => setTimeout(r, 5)); watch();
    }
    for (const t of textOf(document.body)) expect(t).not.toMatch(BAD);

    app.router!.go("about");
    await vi.waitFor(() => expect(document.body.dataset.page).toBe("about"));
    const objects = document.getElementById("objects")!;
    expect(objects.textContent).toContain("Exterior column");
    expect(objects.textContent).toMatch(/AI 0\.30/);        // low confidence: the chip value, honestly
    for (const t of textOf(document.body)) expect(t).not.toMatch(BAD);
    watch();

    for (const p of ["check", "summary"] as const) { app.router!.go(p); await new Promise(r => setTimeout(r, 5)); watch(); }
    for (const t of textOf(document.body)) expect(t).not.toMatch(BAD);

    const host = document.createElement("div");
    renderSummary(host, pkg, pkg.routes[0], { floorPlan: false });
    for (const t of textOf(host)) expect(t).not.toMatch(BAD);

    expect(spoken.length).toBeGreaterThan(0);
    for (const s of spoken) expect(s).not.toMatch(BAD);
    for (const c of captions) expect(c).not.toMatch(BAD);
    vi.unstubAllGlobals();
  });

  it("the shipped clinic and Office B packages never contain the word", () => {
    for (const sid of ["x37LjPx62VA", "hpGRjK5uFPW"]) {
      let txt: string;
      try { txt = readFileSync(join(here, "..", "..", "public", "buildings", sid, "package.json"), "utf8"); } catch { continue; }
      expect(txt, sid).not.toMatch(BAD);
    }
  });
});
