// Test doubles for Web Audio, speechSynthesis and the fixture package (vitest only).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildingPackage } from "../types";

export function fixturePkg(): BuildingPackage {
  const p = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "buildings", "fixture", "package.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

const param = () => ({
  value: 0, setValueAtTime() { return this; }, linearRampToValueAtTime() { return this; },
  /** The last value a setTargetAtTime aimed at (undefined: never), for tests of the continuous sounds. */
  target: undefined as number | undefined,
  setTargetAtTime(v: number) { this.target = v; return this; }, exponentialRampToValueAtTime() { return this; },
  cancelScheduledValues() { return this; },
});

/** Any AudioNode: connect/disconnect/start/stop, and any other property reads as an AudioParam. */
function node(): any {
  const base: any = { outs: [] as any[], starts: 0, connect: (n: any) => { base.outs.push(n); return n; }, disconnect() {},
    start() { base.starts++; }, stop() {}, onended: null };
  return new Proxy(base, {
    get(t, k) { if (!(k in t) && typeof k === "string") t[k] = param(); return t[k]; },
    set(t, k, v) { t[k] = v; return true; },
  });
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: string = "suspended";
  sampleRate = 48000;
  currentTime = 0;
  baseLatency = 0.01;
  outputLatency = 0.02;
  destination = node();
  listener = node();
  onstatechange: (() => void) | null = null;
  constructor(public opts?: unknown) { FakeAudioContext.instances.push(this); }
  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  createBuffer(ch: number, len: number, sr: number) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr,
      getChannelData: (i: number) => data[i] };
  }
  decodeAudioData() { return Promise.resolve(this.createBuffer(1, 4800, 48000)); }
  createBufferSource() { return node(); }
  createGain() { return node(); }
  createChannelSplitter() { return node(); }
  createChannelMerger() { return node(); }
  createDynamicsCompressor() { return node(); }
  createConvolver() { return node(); }
  createStereoPanner() { return node(); }
  createPanner() { return node(); }
  createBiquadFilter() { return node(); }
  /** Every oscillator made on this context, in order (tests read their type and frequency). */
  oscillators: any[] = [];
  createOscillator() { const o = node(); this.oscillators.push(o); return o; }
}

export class FakeUtterance {
  rate = 1; voice: unknown = null; lang = ""; onend: any = null; onerror: any = null; onstart: any = null;
  constructor(public text: string) {}
}

export function fakeSynth(voices: unknown[] = []) {
  const calls: string[] = [];
  const spoken: FakeUtterance[] = [];
  const s: any = {
    calls, spoken, speaking: false, paused: false, pending: false, onvoiceschanged: null,
    listeners: {} as Record<string, (() => void)[]>,
    speak(u: FakeUtterance) { calls.push("speak"); spoken.push(u); s.speaking = true; },
    cancel() { calls.push("cancel"); s.speaking = false; },
    resume() { calls.push("resume"); },
    getVoices: () => voices,
    addEventListener(k: string, f: () => void) { (s.listeners[k] ??= []).push(f); },
    fire(k: string) { (s.listeners[k] ?? []).forEach((f: () => void) => f()); s["on" + k]?.(); },
  };
  return s;
}

/**
 * A tiny package from ASCII rows (top row = highest y), 1 m cells, origin (0,0):
 * '.' free, '#' wall, 'g' glass, 's' stairs, 'o' fixed obstacle. For geometry tests.
 */
export function gridPkg(rows: string[], extra: Partial<BuildingPackage> = {}): BuildingPackage {
  const h = rows.length, w = rows[0].length;
  const code: Record<string, number> = { ".": 0, "#": 1, o: 2, m: 3, g: 4, s: 5 };
  const cells = new Uint8Array(w * h);
  rows.forEach((row, i) => { for (let c = 0; c < w; c++) cells[(h - 1 - i) * w + c] = code[row[c]] ?? 0; });
  const base = fixturePkg();
  return { ...base, grid: { res: 1, width: w, height: h, origin: [0, 0], cells_b64: Buffer.from(cells).toString("base64") },
    rooms: [], doors: [], landmarks: [], entrances: [], routes: [], ...extra };
}
