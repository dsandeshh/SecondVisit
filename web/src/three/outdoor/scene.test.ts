import { describe, expect, it } from "vitest";
import { simplify, simplifyRing } from "./scene";

describe("outline simplify", () => {
  it("keeps the corners of a closed square with noisy edges", () => {
    const ring: [number, number][] = [];
    for (let i = 0; i <= 10; i++) ring.push([i, 0.02 * (i % 2)]);
    for (let i = 1; i <= 10; i++) ring.push([10, i]);
    for (let i = 9; i >= 0; i--) ring.push([i, 10]);
    for (let i = 9; i >= 1; i--) ring.push([0, i]);
    const s = simplifyRing(ring, 0.1);
    expect(s.length).toBeGreaterThanOrEqual(4); expect(s.length).toBeLessThanOrEqual(6);
    expect(s.some(p => p[0] === 10 && p[1] === 10)).toBe(true);
  });
  it("an open straight line is two points", () => { expect(simplify([[0, 0], [1, 0.01], [2, 0]], 0.1)).toHaveLength(2); });
});
