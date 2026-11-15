import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme"));
const v = (n: string) => root.match(new RegExp(`${n}:\\s*(#[0-9A-Fa-f]{6})`))![1];
const lum = (h: string) => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
  .map(x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("tokens contrast (light)", () => {
  it.each([
    ["--c-ink", "--c-paper", 7], ["--c-ink-2", "--c-paper", 7], ["--c-on-sign", "--c-sign", 7],
    ["--c-on-mark", "--c-mark", 7], ["--c-good", "--c-paper", 4.5], ["--c-bad", "--c-paper", 4.5],
    ["--c-rule", "--c-paper", 3], ["--d-route", "--c-surface", 3], ["--d-glass", "--c-surface", 3],
  ])("%s on %s >= %d", (a, b, min) => expect(ratio(v(a), v(b))).toBeGreaterThanOrEqual(min));
});

// ---- glass ----
const lightBlock = root;
const darkStart = css.indexOf(':root[data-theme="dark"] {');
const darkBlock = css.slice(darkStart, css.indexOf("\n  }", darkStart));

const hexIn = (block: string, n: string) => {
  const m = block.match(new RegExp(`${n}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${n} not found`);
  return m[1];
};
const rgbOf = (h: string): [number, number, number] =>
  [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const tint = (block: string, n: string) => {
  const m = block.match(new RegExp(`${n}:\\s*rgb\\(\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*/\\s*([\\d.]+)\\s*\\)`));
  if (!m) throw new Error(`${n} not found`);
  return { rgb: [+m[1], +m[2], +m[3]] as [number, number, number], a: +m[4] };
};
const lumRgb = (c: [number, number, number]) => {
  const [r, g, b] = c.map(x => x / 255).map(x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratioRgb = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [lumRgb(a), lumRgb(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05);
};
const over = (t: { rgb: [number, number, number]; a: number }, bg: number): [number, number, number] =>
  t.rgb.map(c => c * t.a + bg * (1 - t.a)) as [number, number, number];

describe("glass alpha keeps 7:1", () => {
  const cases: [string, string, string, string[]][] = [
    ["light bar", lightBlock, "--glass-bar-tint", ["--c-on-sign"]],
    ["light panel", lightBlock, "--glass-panel-tint", ["--c-ink", "--c-ink-2"]],
    ["dark bar", darkBlock, "--glass-bar-tint", ["--c-on-sign"]],
    ["dark panel", darkBlock, "--glass-panel-tint", ["--c-ink", "--c-ink-2"]],
  ];
  for (const [label, block, tintName, texts] of cases)
    for (const textName of texts)
      for (const [bgName, bg] of [["white", 255], ["black", 0]] as const)
        it(`${label}: ${textName} over ${bgName} >= 7`, () => {
          const fill = over(tint(block, tintName), bg);
          expect(ratioRgb(rgbOf(hexIn(block, textName)), fill)).toBeGreaterThanOrEqual(7);
        });
});

describe("no glass on visitor screens", () => {
  const webDir = fileURLToPath(new URL("../../", import.meta.url));
  const srcDir = join(webDir, "src");
  const skip = ["observer", "venue", "trace"].map(d => join(srcDir, d) + sep);
  const tokensCss = join(srcDir, "styles", "tokens.css");
  const files: string[] = [join(webDir, "index.html")];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (!skip.includes(p + sep)) walk(p); }
      else if (p !== tokensCss && p !== fileURLToPath(import.meta.url)) files.push(p);
    }
  };
  walk(srcDir);
  it("scans files", () => expect(files.length).toBeGreaterThan(2));
  it.each(files.map(f => [relative(webDir, f), f]))("%s has no glass", (_n, f) => {
    const text = readFileSync(f, "utf8");
    expect(text).not.toMatch(/backdrop-filter/);
    expect(text).not.toMatch(/glass-/);
  });
});

describe("tokens.ts helpers", () => {
  it("exports the UI_DESIGN 2.1 helpers", async () => {
    const m = await import("./tokens");
    for (const n of ["token", "reducedMotion", "planPalette", "onPrefsChange", "hatch", "fitCanvas"])
      expect(typeof (m as Record<string, unknown>)[n]).toBe("function");
  });
});
