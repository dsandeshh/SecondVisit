// Pre rendered tap buffers, one per material plus floor tick, bump and footstep (agent3 3.1).
// Rendered once at Start so a contact plays with zero synthesis delay.
import type { CellCode } from "../types";

export type TapKind = CellCode | "floor" | "bump" | "step";
export const TAP_KINDS: TapKind[] = [0, 1, 2, 3, 4, 5, "floor", "bump", "step"];

/** RBJ biquad, applied in place. */
function biquad(x: Float32Array, sr: number, type: "bp" | "lp", f: number, q: number): Float32Array {
  const w = 2 * Math.PI * f / sr, a = Math.sin(w) / (2 * q), c = Math.cos(w);
  let b0, b1, b2;
  if (type === "bp") { b0 = a; b1 = 0; b2 = -a; } else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}

function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1; }

function normalise(x: Float32Array, peak: number): Float32Array {
  let m = 0; for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

/** Samples for one tap kind at sample rate sr. Pure, so it can be tested and cached. */
export function synth(kind: TapKind, sr: number): Float32Array {
  const n = (s: number) => Math.max(1, Math.round(s * sr));
  const r = rng(typeof kind === "number" ? kind + 11 : kind.length + 101);
  const noiseBurst = (len: number, ms: number) => {
    const x = new Float32Array(len), m = n(ms / 1000);
    for (let i = 0; i < m && i < len; i++) x[i] = r() * (1 - i / m);
    return x;
  };
  const partials = (x: Float32Array, fs: number[], decayS: number, amp: number) => {
    for (let i = 0; i < x.length; i++) {
      const t = i / sr, e = Math.exp(-t / (decayS / 4)) * amp;
      for (let k = 0; k < fs.length; k++) x[i] += e * Math.sin(2 * Math.PI * fs[k] * t) / (k + 1);
    }
    return x;
  };
  switch (kind) {
    case 1: { // wall: dry "tock", bright noise plus a low thump
      const x = biquad(noiseBurst(n(0.04), 6), sr, "bp", 2200, 1.2);
      normalise(x, 0.8);
      for (let i = 0; i < n(0.03); i++) x[i] += 0.25 * Math.sin(2 * Math.PI * 180 * i / sr) * (1 - i / n(0.03));
      return normalise(x, 0.8);
    }
    case 2: { // fixed obstacle: duller knock
      const x = biquad(noiseBurst(n(0.06), 8), sr, "bp", 900, 4);
      for (let i = 0; i < x.length; i++) x[i] *= Math.exp(-i / sr / 0.012);
      return normalise(x, 0.8);
    }
    case 3: // movable: metallic tink
      return normalise(partials(noiseBurst(n(0.12), 2), [1700, 3900, 6100], 0.12, 0.3), 0.6);
    case 4: { // glass: sharp click and a ring, higher
      const x = partials(noiseBurst(n(0.25), 1.5), [2800, 4100, 6300], 0.25, 0.35);
      return normalise(x, 0.7);
    }
    case 5: { // stairs or drop: short downward slide
      const x = new Float32Array(n(0.18)); let ph = 0;
      for (let i = 0; i < x.length; i++) {
        const t = i / x.length; ph += 2 * Math.PI * (700 - 450 * t) / sr;
        x[i] = Math.sin(ph) * (1 - t) * 0.6;
      }
      return x;
    }
    case 0: case "floor": // very quiet soft tick, about -24 dB
      return normalise(biquad(noiseBurst(n(0.02), 3), sr, "lp", 1800, 0.7), 0.063);
    case "bump": { // low thump, louder than taps
      const x = new Float32Array(n(0.06));
      for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * 90 * i / sr) * Math.exp(-i / sr / 0.02);
      return normalise(x, 0.95);
    }
    case "step": // footstep: low passed noise
      return normalise(biquad(noiseBurst(n(0.04), 30), sr, "lp", 500, 0.7), 0.35);
  }
}

export function renderTaps(ctx: BaseAudioContext): Record<TapKind, AudioBuffer> {
  const out = {} as Record<TapKind, AudioBuffer>;
  for (const k of TAP_KINDS) {
    const s = synth(k, ctx.sampleRate);
    const b = ctx.createBuffer(1, s.length, ctx.sampleRate);
    b.getChannelData(0).set(s);
    out[k] = b;
  }
  return out;
}
