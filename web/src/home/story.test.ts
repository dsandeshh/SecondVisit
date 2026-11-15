// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boot, focusables } from "../app_v2";
import { fixturePkg } from "../test/fakes";
import { homeVariant, mountStory, STATIC_T } from "./story";

vi.mock("../pages/showcase_hook", () => ({ loadShowcase: async () => null }));

const shell = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../pages/shell_v2.html"), "utf8");
const load = () => { document.body.innerHTML = shell; document.body.dataset.page = "home"; };
const homeHtml = () => document.getElementById("home")!.outerHTML;
const FOCUSABLE = "a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]";

async function bootWith(q: string) {
  load();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => fixturePkg() })));
  await boot(document, new URLSearchParams(q));
}
const reduced = (on: boolean) => vi.stubGlobal("matchMedia", (m: string) => ({ matches: on && /reduced-motion/.test(m), media: m, addEventListener() {}, removeEventListener() {} }));

afterEach(() => vi.unstubAllGlobals());

describe("home variant", () => {
  it("plain is the default; only ?home=story turns the story on", () => {
    expect(homeVariant(new URLSearchParams(""))).toBe("plain");
    expect(homeVariant(new URLSearchParams("home=plain"))).toBe("plain");
    expect(homeVariant(new URLSearchParams("home=other"))).toBe("plain");
    expect(homeVariant(new URLSearchParams("home=story"))).toBe("story");
  });

  it("no param and ?home=plain render the same home as before, with no story layer", async () => {
    await bootWith("b=fixture");
    const none = homeHtml();
    expect(document.querySelector(".home-story")).toBeNull();
    expect(document.getElementById("home")!.dataset.home).toBeUndefined();
    await bootWith("b=fixture&home=plain");
    expect(homeHtml()).toBe(none);
  });

  it("?home=story keeps Start first and the same focus order as plain", async () => {
    await bootWith("b=fixture");
    const plain = focusables(document).map(e => e.id || e.textContent);
    reduced(false);
    await bootWith("b=fixture&home=story");
    expect(document.querySelector(".home-story")).not.toBeNull();
    const story = focusables(document).map(e => e.id || e.textContent);
    expect(story[0]).toBe("start");
    expect(story).toEqual(plain);
  });

  it("the story layer is aria-hidden, has nothing focusable, takes no pointer and has no media", async () => {
    reduced(false);
    await bootWith("b=fixture&home=story");
    const el = document.querySelector<HTMLElement>(".home-story")!;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    expect(el.querySelectorAll("audio, video, img, image, foreignObject")).toHaveLength(0);
    expect(el.querySelector("svg")!.getAttribute("focusable")).toBe("false");
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles/pages.css"), "utf8");
    expect(css).toMatch(/\.home-story \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.home-story \{[^}]*position: absolute[^}]*height: 40vh/);   // fixed-size layer: no layout shift
  });

  it("reduced motion draws one static frame and runs no animation", () => {
    load();
    reduced(true);
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    const s = mountStory(document)!;
    expect(raf).not.toHaveBeenCalled();
    expect(s.running()).toBe(false);
    expect(s.el.dataset.static).toBe("true");
    expect(Number(s.el.dataset.t)).toBeCloseTo(STATIC_T, 1);
    expect(s.el.querySelector(".st-walker--out")!.getAttribute("transform")).toMatch(/translate/);
  });

  it("with motion it loops, and stops while Home is hidden", async () => {
    load();
    reduced(false);
    const s = mountStory(document)!;
    expect(s.running()).toBe(true);
    document.getElementById("home")!.hidden = true;
    await Promise.resolve();
    expect(s.running()).toBe(false);
    s.stop();
  });

  it("the loop is seamless: blank at the seam, the same frame at 0 and 14 s", () => {
    load();
    reduced(true);
    const s = mountStory(document)!;
    s.draw(0); const a = s.el.innerHTML; const o = s.el.style.opacity;
    s.draw(14); expect(s.el.innerHTML).toBe(a); expect(s.el.style.opacity).toBe(o);
    expect(Number(o)).toBe(0);
    s.draw(13.99); expect(Number(s.el.style.opacity)).toBeLessThan(0.02);
  });
});
