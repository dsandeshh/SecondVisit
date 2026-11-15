import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lineId, normaliseLine } from "./lines";

describe("voice line ids", () => {
  it("match the engine hash rule (sha1 of the normalised text, 12 hex)", () => {
    expect(lineId("Reception desk")).toBe("24391e11a28b"); // python: sha1(b"Reception desk").hexdigest()[:12]
    expect(lineId("  Reception \n desk ")).toBe("24391e11a28b");
    expect(lineId("reception desk")).not.toBe(lineId("Reception desk")); // case kept
    expect(normaliseLine(" a   b\tc ")).toBe("a b c");
  });
  it("handles multi block and non ascii input", () => {
    expect(lineId("x".repeat(200))).toBe("94218caae990");
    expect(lineId("Café")).toBe("7d6408613397");
  });
});

describe("shared golden ids and clip coverage", () => {
  it("web ids equal the engine's line_id for the golden sample set (engine/tests/line_id_golden.json)", () => {
    const rows = JSON.parse(readFileSync(new URL("../../engine/tests/line_id_golden.json", import.meta.url), "utf8")) as { text: string; id: string }[];
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(lineId(r.text), r.text).toBe(r.id);
  });
  const dir = new URL("../public/buildings/x37LjPx62VA/", import.meta.url);
  it.skipIf(!existsSync(new URL("package.json", dir)) || !existsSync(new URL("voice/index.json", dir)))(
    "every line in the clinic package's voice_lines has a clip in voice/index.json", () => {
      const pkg = JSON.parse(readFileSync(new URL("package.json", dir), "utf8")) as { voice_lines?: { id: string; text: string }[] };
      const idx = JSON.parse(readFileSync(new URL("voice/index.json", dir), "utf8")) as Record<string, string>;
      const missing = (pkg.voice_lines ?? []).filter(l => !(l.id in idx));
      expect(missing.map(l => l.text)).toEqual([]);
      for (const l of pkg.voice_lines ?? []) expect(lineId(l.text)).toBe(l.id);
    });
});
