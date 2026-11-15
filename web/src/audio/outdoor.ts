// Outdoor sound (agent6 4.1.5), on the same buses and HRTF chain as the interior. Everything here is a stand in
// placed by geometry: the traffic bed on the CoStar frontage line is labelled `simulated`.
// Imports spatialChain / AudioEngine only; the interior audio files are not touched.
import type { AudioEngine } from "./engine";
import { azimuth, toAudio } from "./space";
import { spatialChain } from "./spatial";
import type { Vec2 } from "../types";

export const TRAFFIC_LP_OPEN_HZ = 700;
export const TRAFFIC_LP_CANOPY_HZ = 450;
export const BEACON_PERIOD_MS = 500;
export const ON_AXIS_DEG = 15;
export const HANDOFF_S = 1.5;

/** Three source points on the road: spaced `spacing` m along the frontage, `out` m farther from the building. */
export function trafficPoints(line: [Vec2, Vec2], toward: Vec2, spacing = 20, out = 8): Vec2[] {
  const [a, b] = line, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let nx = -uy, ny = ux; // normal; point away from `toward` (the building side)
  if ((mid[0] - toward[0]) * nx + (mid[1] - toward[1]) * ny < 0) { nx = -nx; ny = -ny; }
  return [-spacing, 0, spacing].map(t => [mid[0] + ux * t + nx * out, mid[1] + uy * t + ny * out] as Vec2);
}

/** The road line when the package has only the nearest frontage point: through it, square to the curb direction. */
export function roadLine(point: Vec2, curb: Vec2, half = 40): [Vec2, Vec2] {
  const dx = point[0] - curb[0], dy = point[1] - curb[1], L = Math.hypot(dx, dy) || 1;
  const ux = -dy / L, uy = dx / L;
  return [[point[0] - ux * half, point[1] - uy * half], [point[0] + ux * half, point[1] + uy * half]];
}

/** Which beacon recipe: the high tick when the door is within 15 degrees of the heading, a low one behind. */
export function beaconRecipe(pos: Vec2, heading: number, door: Vec2): "pulse" | "pulseOn" | "pulseBehind" {
  const az = Math.abs(azimuth(pos, heading, door));
  return az <= ON_AXIS_DEG ? "pulseOn" : az > 100 ? "pulseBehind" : "pulse";
}

function brownNoise(ctx: BaseAudioContext, seconds = 4): AudioBuffer {
  const n = Math.round(seconds * ctx.sampleRate), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let y = 0, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) { y = (y + 0.02 * rnd()) / 1.02; d[i] = y * 3.5; }
  const f = Math.round(0.05 * ctx.sampleRate); // loop seam
  for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
  return b;
}

export type OutdoorSoundWorld = { door: Vec2; road: Vec2[]; doorType?: string | null };

export class OutdoorAudio {
  private nodes: AudioNode[] = [];
  private lp: BiquadFilterNode | null = null;
  private master: GainNode | null = null;
  private wet: GainNode | null = null;
  private conv: ConvolverNode | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private beacon: ReturnType<typeof setInterval> | null = null;
  private pose = { pos: [0, 0] as Vec2, heading: 0 };
  private src: AudioBufferSourceNode[] = [];
  private stopped = false;

  constructor(private audio: AudioEngine, private world: OutdoorSoundWorld) {}

  /** Traffic bed (3 HRTF panners on the road) and the pass-by swells. */
  start(at: Vec2, heading: number): void {
    const c = this.audio.ctx, bus = this.audio.buses?.ambient; if (!c || !bus) return;
    this.pose = { pos: at, heading };
    this.audio.listen(at, heading);
    const master = c.createGain(); master.gain.value = 1; master.connect(bus); this.master = master;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = TRAFFIC_LP_OPEN_HZ; lp.connect(master); this.lp = lp;
    const noise = brownNoise(c);
    for (const p of this.world.road) {
      const s = c.createBufferSource(); s.buffer = noise; s.loop = true;
      const g = c.createGain(); g.gain.value = 0.25 / 3 * 2.2;
      const ch = spatialChain(c, p, this.pose, { rolloff: 1, ref: 2 });
      s.connect(g); g.connect(ch.input); ch.output.connect(lp);
      s.start(); this.src.push(s); this.nodes.push(g, ch.panner, ch.output);
    }
    this.scheduleSwell();
  }

  private scheduleSwell(): void {
    const t = setTimeout(() => { if (this.stopped) return; this.swell(); this.scheduleSwell(); }, 4000 + Math.random() * 5000);
    this.timers.push(t);
  }

  /** A car passing: a 3 s noise swell whose panner moves along the road at 13 m/s. */
  private swell(): void {
    const c = this.audio.ctx; if (!c || !this.lp || this.world.road.length < 3) return;
    const a = this.world.road[0], b = this.world.road[2], dir = Math.random() < 0.5 ? 1 : -1;
    const from = dir > 0 ? a : b, to = dir > 0 ? b : a;
    const L = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1, travel = Math.min(L, 13 * 3);
    const end: Vec2 = [from[0] + (to[0] - from[0]) / L * travel, from[1] + (to[1] - from[1]) / L * travel];
    const s = c.createBufferSource(); s.buffer = brownNoise(c, 3);
    const g = c.createGain(), now = c.currentTime;
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.5, now + 1.2); g.gain.linearRampToValueAtTime(0, now + 3);
    const ch = spatialChain(c, from, this.pose, { rolloff: 1, ref: 2 });
    const [x0, , z0] = toAudio(from), [x1, , z1] = toAudio(end);
    ch.panner.positionX.setValueAtTime(x0, now); ch.panner.positionZ.setValueAtTime(z0, now);
    ch.panner.positionX.linearRampToValueAtTime(x1, now + 3); ch.panner.positionZ.linearRampToValueAtTime(z1, now + 3);
    s.connect(g); g.connect(ch.input); ch.output.connect(this.lp);
    s.onended = () => { try { s.disconnect(); g.disconnect(); ch.output.disconnect(); ch.panner.disconnect(); } catch { /* gone */ } };
    s.start(now);
  }

  setPose(pos: Vec2, heading: number): void { this.pose = { pos, heading }; this.audio.listen(pos, heading); }

  /** Door beacon: 2 pulses a second from the door pin, the high tick when it is on axis. Stops within 1 m (caller). */
  beaconOn(): void {
    if (this.beacon) return;
    this.beacon = setInterval(() => {
      const r = beaconRecipe(this.pose.pos, this.pose.heading, this.world.door);
      this.audio.cue(r, { bus: "cue", at: this.world.door, pri: 1, label: "Door", announce: false });
    }, BEACON_PERIOD_MS);
  }
  beaconOff(): void { if (this.beacon) clearInterval(this.beacon); this.beacon = null; }

  /** Two clicks at 1.2 kHz, 80 ms apart, at the edge line. */
  edge(at: Vec2): void {
    const c = this.audio.ctx; if (!c) return;
    for (const dt of [0, 0.08]) {
      const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + dt;
      o.frequency.value = 1200; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      const ch = spatialChain(c, at, this.pose, { rolloff: 1, ref: 2 });
      o.connect(g); g.connect(ch.input); ch.output.connect(this.audio.buses!.safety);
      o.start(t); o.stop(t + 0.05);
      o.onended = () => { try { o.disconnect(); g.disconnect(); ch.output.disconnect(); ch.panner.disconnect(); } catch { /* gone */ } };
    }
  }

  /** Under the canopy: reverb wet 0 to 0.35 over 0.5 s, the traffic lowpass 700 to 450 Hz (sound shadow). */
  canopy(inside: boolean): void {
    const c = this.audio.ctx; if (!c || !this.lp) return;
    const now = c.currentTime;
    if (!this.conv) {
      this.conv = c.createConvolver();
      const n = Math.round(0.4 * c.sampleRate), b = c.createBuffer(2, n, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-6.91 * i / n); }
      this.conv.buffer = b;
      this.wet = c.createGain(); this.wet.gain.value = 0;
      this.master!.connect(this.conv); this.conv.connect(this.wet); this.wet.connect(this.audio.buses!.ambient);
    }
    this.wet!.gain.setTargetAtTime(inside ? 0.35 : 0, now, 0.15);
    this.lp.frequency.setTargetAtTime(inside ? TRAFFIC_LP_CANOPY_HZ : TRAFFIC_LP_OPEN_HZ, now, 0.15);
  }

  /** Outdoor master to 0 over 1.5 s, then everything stops. */
  async handoff(): Promise<void> {
    const c = this.audio.ctx;
    this.beaconOff();
    if (c && this.master) {
      this.master.gain.setValueAtTime(this.master.gain.value, c.currentTime);
      this.master.gain.linearRampToValueAtTime(0, c.currentTime + HANDOFF_S);
      await new Promise(r => setTimeout(r, HANDOFF_S * 1000));
    }
    this.stop();
  }

  stop(): void {
    this.stopped = true;
    this.beaconOff();
    this.timers.forEach(clearTimeout); this.timers = [];
    for (const s of this.src) { try { s.stop(); } catch { /* not started */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* gone */ } }
    try { this.master?.disconnect(); this.wet?.disconnect(); this.conv?.disconnect(); } catch { /* gone */ }
    this.src = []; this.nodes = [];
  }
}
