// Sound recipes for the interactions (review/agent5_interaction.md 4.3): mono samples rendered once at Start into
// AudioBuffers, so a sound plays with no synthesis delay. Pure sample functions first (testable), buffers second.
export type RecipeName = "pulse" | "pulseOn" | "pulseBehind" | "cornerTicks" | "chime" | "thud" | "jamb" | "jambGlass" | "sweepStart" | "namePing";
export const RECIPES: RecipeName[] = ["pulse", "pulseOn", "pulseBehind", "cornerTicks", "chime", "thud", "jamb", "jambGlass", "sweepStart", "namePing"];

const TAU = Math.PI * 2;
const EDGE_S = 0.002;
function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1; }

/** Hearify's `make`: fill n samples, 2 ms raised cosine edges, normalise to `peak`. */
function make(sr: number, seconds: number, peak: number, f: (t: number, i: number) => number): Float32Array {
  const n = Math.max(1, Math.round(seconds * sr)), x = new Float32Array(n), e = Math.max(1, Math.round(EDGE_S * sr));
  for (let i = 0; i < n; i++) x[i] = f(i / sr, i);
  for (let i = 0; i < Math.min(e, n); i++) { const w = 0.5 - 0.5 * Math.cos(Math.PI * i / e); x[i] *= w; x[n - 1 - i] *= w; }
  let m = 0; for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < n; i++) x[i] *= peak / m;
  return x;
}

function bandpass(x: Float32Array, sr: number, f: number, q: number): Float32Array {
  const w = TAU * f / sr, a = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const y = (a * x[i] - a * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}

const sine = (f: number, t: number) => Math.sin(TAU * f * t);
const attack = (t: number, s: number) => Math.min(1, t / s);

export function recipe(name: RecipeName, sr = 48000): Float32Array {
  const r = rng(12345);
  switch (name) {
    case "pulse": return make(sr, 0.12, 0.5, t => sine(880, t) * attack(t, 0.005) * Math.exp(-t / 0.03));
    case "pulseOn": return make(sr, 0.12, 0.55, t => (sine(880, t) + 0.5 * sine(1760, t)) * attack(t, 0.005) * Math.exp(-t / 0.03));
    case "pulseBehind": return make(sr, 0.14, 0.5, t => sine(660, t) * attack(t, 0.005) * Math.exp(-t / 0.04));
    case "cornerTicks": return make(sr, 0.11, 0.3, t => {
      const blip = (t0: number) => (t >= t0 && t < t0 + 0.02 ? sine(1320, t - t0) * Math.exp(-(t - t0) / 0.006) : 0);
      return blip(0) + blip(0.07);
    });
    case "chime": return make(sr, 0.6, 0.6, t => sine(660, t) * Math.exp(-t / 0.12) + (t >= 0.15 ? sine(990, t - 0.15) * Math.exp(-(t - 0.15) / 0.15) : 0));
    case "thud": { // 70 Hz body plus a noise click in the first 6 ms (a sine alone is poorly localised)
      const noise = bandpass(Float32Array.from({ length: Math.round(0.25 * sr) }, r), sr, 1200, 1);
      return make(sr, 0.25, 0.8, (t, i) => sine(70, t) * Math.exp(-t / 0.05) + (t < 0.006 ? 0.25 * noise[i] * 6 : 0));
    }
    case "jamb": { // a dry wooden "tok": 4 ms noise burst at 3 kHz plus a 600 Hz sine
      const noise = bandpass(Float32Array.from({ length: Math.round(0.03 * sr) }, r), sr, 3000, 2);
      return make(sr, 0.03, 0.35, (t, i) => (t < 0.004 ? noise[i] * 4 : 0) + sine(600, t) * Math.exp(-t / 0.008));
    }
    case "jambGlass": {
      const click = bandpass(Float32Array.from({ length: Math.round(0.25 * sr) }, r), sr, 5000, 2);
      return make(sr, 0.25, 0.3, (t, i) => (t < 0.003 ? click[i] * 3 : 0) + (sine(2800, t) + 0.7 * sine(4100, t) + 0.5 * sine(6300, t)) * Math.exp(-t / 0.08) * 0.5);
    }
    case "sweepStart": { // chirp 400 to 1200 Hz, phase accumulated
      const T = 0.12; let ph = 0;
      return make(sr, T, 0.2, t => { ph += TAU * (400 + 800 * t / T) / sr; return Math.sin(ph) * Math.sin(Math.PI * t / T); });
    }
    case "namePing": return make(sr, 0.12, 0.4, t => (t < 0.06 ? sine(523, t) : sine(784, t - 0.06)) * Math.exp(-(t % 0.06) / 0.02));
  }
}

export function renderRecipes(ctx: BaseAudioContext): Record<RecipeName, AudioBuffer> {
  const out = {} as Record<RecipeName, AudioBuffer>;
  for (const n of RECIPES) {
    const x = recipe(n, ctx.sampleRate), b = ctx.createBuffer(1, x.length, ctx.sampleRate);
    b.getChannelData(0).set(x);
    out[n] = b;
  }
  return out;
}
