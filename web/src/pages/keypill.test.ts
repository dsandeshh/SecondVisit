// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KEYPILL_TEXT, mountKeyPill } from "./keypill";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "styles", "pages.css"), "utf8");
const tokens = readFileSync(join(here, "..", "styles", "tokens.css"), "utf8");
const html = readFileSync(join(here, "shell_v2.html"), "utf8");

/** WCAG 2.x relative luminance and contrast ratio of two #RRGGBB colours. */
function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** The value of a custom property in the light block (first match) and the dark block (the prefers-color-scheme one). */
function token(name: string): { light: string; dark: string } {
  const re = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`, "g");
  const all = [...tokens.matchAll(re)].map(m => m[1]);
  const darkAt = tokens.indexOf("prefers-color-scheme: dark");
  const dark = [...tokens.slice(darkAt).matchAll(re)].map(m => m[1])[0];
  return { light: all[0], dark };
}

describe("key pill", () => {
  afterEach(() => vi.useRealTimers());
  it("uses --c-ink-2 on --c-surface-2, and that measures at least 4.5:1 in light and dark", () => {
    const rule = css.slice(css.indexOf(".keypill {"), css.indexOf("}", css.indexOf(".keypill {")));
    expect(rule).toContain("color: var(--c-ink-2)");
    expect(rule).toContain("background: var(--c-surface-2)");
    expect(rule).not.toMatch(/opacity/);                    // never dimmed while it shows
    const ink = token("--c-ink-2"), bg = token("--c-surface-2");
    expect(contrast(ink.light, bg.light)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink.dark, bg.dark)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5); // the helper itself
  });
  it("one short row in the shell, fades after 5 s without a key, back at once on any key or ?", () => {
    vi.useFakeTimers();
    document.body.innerHTML = html;
    const el = document.getElementById("keypill")!;
    expect(el.textContent).toBe(KEYPILL_TEXT);
    expect(KEYPILL_TEXT.length).toBeLessThan(70);
    const p = mountKeyPill(document);
    expect(el.classList.contains("is-idle")).toBe(false);
    vi.advanceTimersByTime(4900); expect(el.classList.contains("is-idle")).toBe(false);
    vi.advanceTimersByTime(200); expect(el.classList.contains("is-idle")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(el.classList.contains("is-idle")).toBe(false);
    vi.advanceTimersByTime(5100); expect(el.classList.contains("is-idle")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    expect(el.classList.contains("is-idle")).toBe(false);
    p.destroy();
  });
});
