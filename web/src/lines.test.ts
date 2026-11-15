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
