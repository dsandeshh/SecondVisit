import { describe, expect, it } from "vitest";
import { RECIPES, recipe } from "./recipes";

const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe("sound recipes (agent5 4.3)", () => {
  it("lengths and peaks follow the table", () => {
    const table: Record<string, [number, number]> = { pulse: [0.12, 0.5], pulseOn: [0.12, 0.55], pulseBehind: [0.14, 0.5], cornerTicks: [0.11, 0.3],
      chime: [0.6, 0.6], thud: [0.25, 0.8], jamb: [0.03, 0.35], jambGlass: [0.25, 0.3], sweepStart: [0.12, 0.2], namePing: [0.12, 0.4] };
    for (const n of RECIPES) {
      const x = recipe(n, 48000), [len, pk] = table[n];
      expect(x.length).toBe(Math.round(len * 48000));
      expect(peak(x)).toBeCloseTo(pk, 3);
      expect(x.every(Number.isFinite)).toBe(true);
    }
  });
  it("edges are faded so nothing clicks, and the thud has body below the click", () => {
    const x = recipe("pulse"); expect(Math.abs(x[0])).toBeLessThan(0.01); expect(Math.abs(x[x.length - 1])).toBeLessThan(0.01);
    const t = recipe("thud");
    const low = t.slice(Math.round(0.02 * 48000), Math.round(0.1 * 48000));
    expect(peak(low)).toBeGreaterThan(0.1);
  });
});
