// The two continuous sounds (human decision 15 Nov 04:28): a soft target beacon from the target's true direction, and
// an obstacle proximity tick for the nearest solid thing in the 60 degree cone ahead within 3 m. They are the only two
// sounds that play without a key; each has one persistent HRTF chain (outside the one shot budget) that is moved every
// animation frame (~60 fps, a 40 ms interval as the fallback) from the walker's pose with the smoothed ear heading, so the
// sound sweeps while the walker turns and walks. Both sit on the cue bus, so speech ducks them. The beacon is one
// continuous hum, created once and kept alive (never restarted); its sound model (wobble rate by distance, brightness by
// aim, behind low-pass) is beacon_cue.ts. It sounds from the next corner of the walkable path (Interact.beaconAim); when
// that corner changes, the source glides to the new one over GLIDE_S.
// Pure maths first (tested), the scheduler second.
import type { Vec2 } from "../types";
import { bearing, dirOf, dist, wrap180, type World } from "../world";
import type { AudioEngine } from "./engine";
import { toAudio } from "./space";
import { BEHIND_DEG, spatialChain } from "./spatial";
import { CLICK_EVERY_S, CLICK_HZ, CLICK_LEVEL, CLICK_S, HUM_DETUNE, HUM_PARTIALS, HUM_WEIGHTS, NOISE_HZ, NOISE_MIX, RAMP_S, heard, humParams, wobbleRate, type Cue, type HumParams } from "./beacon_cue";

/** The beacon's panner sits this far from the walker, in the target's true direction: a steady level at any range. */
export const BEACON_R_M = 2;
export const BEACON_GAIN = 0.16;
export const PROX_M = 3, PROX_HALF_DEG = 30, PROX_SLOW_HZ = 2, PROX_FAST_HZ = 9;
export const PROX_GAIN = 0.22;
export const TICK_MS = 40;
/** A change of path corner glides the hum's source to the new corner over about this long. */
export const GLIDE_S = 0.25;
/** Rehearse B (human decision 15 Nov): exactly this many beacon pulses from the destination, this far apart, then
 *  silence; another B is ignored until BURST_HOLD_S after the burst began, so mashing B never becomes a beacon. */
export const BURST_PULSES = 3, BURST_GAP_S = 0.3, BURST_HOLD_S = 2;
const LOOKAHEAD_S = 0.12;
/** The beacon keeps pulsing until the target says it is reached (the 1 m arrival stops it by clearing target());
 *  only this close to the point it sounds from does it fall silent (no direction left to give). */
export const BEACON_MUTE_M = 0.3;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Beacon wobble cycles per second: 1.5 beyond 10 m, 3 at 5 m, 6 within 2 m (beacon_cue.wobbleRate). */
export const beaconRate = wobbleRate;

/** The target's true bearing relative to the heading, (-180, 180], + right: what the beacon's panner angle must be. */
export const beaconAz = (pos: Vec2, heading: number, target: Vec2): number => wrap180(bearing(pos, target) - heading);

/** Where the beacon's panner goes: BEACON_R_M from the walker towards the target (through walls: the true direction). */
export function beaconSpot(pos: Vec2, target: Vec2, r = BEACON_R_M): Vec2 {
  const [dx, dy] = dirOf(bearing(pos, target));
  return [pos[0] + dx * r, pos[1] + dy * r];
}

export type Near = { dist: number; az: number; code: number; at: Vec2 };

/** The nearest solid cell in the cone ahead (rays every `stepDeg` from -half to +half), within maxM, or null. */
export function nearestAhead(world: World, pos: Vec2, heading: number, maxM = PROX_M, half = PROX_HALF_DEG, stepDeg = 5): Near | null {
  let best: Near | null = null;
  for (let a = -half; a <= half + 1e-9; a += stepDeg) {
    const hit = world.raycast(pos, heading + a, maxM);
    if (!hit || (best && hit.dist >= best.dist)) continue;
    const [dx, dy] = dirOf(heading + a);
    best = { dist: hit.dist, az: a, code: hit.code, at: [pos[0] + dx * hit.dist, pos[1] + dy * hit.dist] };
  }
  return best;
}

/** Proximity ticks per second: 0 (silent) beyond 3 m or with nothing ahead, rising to 9 at the face of it. */
export function proxRate(d: number | null | undefined): number {
  if (d === null || d === undefined || !Number.isFinite(d) || d > PROX_M) return 0;
  return PROX_SLOW_HZ + clamp01(1 - d / PROX_M) * (PROX_FAST_HZ - PROX_SLOW_HZ);
}

/** Proximity tick level: 0 beyond 3 m, a little louder as it gets nearer (still well under speech). */
export function proxGain(d: number | null | undefined): number {
  if (proxRate(d) === 0) return 0;
  return PROX_GAIN * (0.5 + 0.5 * clamp01(1 - (d as number) / PROX_M));
}

export type ContinuousDeps = {
  pose: () => { pos: Vec2; heading: number };
  /** The beacon target, or null (no target: the beacon is silent). */
  target: () => Vec2 | null;
  /** False while the walker cannot walk (pointing, quiz, summary, another page): both sounds are silent. */
  live: () => boolean;
  /** True in Rehearse: the continuous beacon never plays (only a B burst does). */
  rehearse?: () => boolean;
  /** Called on every beacon wobble cycle and burst pulse (the ring and the observer). */
  onPulse?: (at: Vec2) => void;
  /** The ear: the walker's position with the smoothed heading (mid turn); the beacon's direction and the audio listener
   *  follow it. Default: pose. */
  ear?: () => { pos: Vec2; heading: number };
  /** Metres to the real target (the wobble rate carries distance), when the beacon sounds from a corner of the path. Default:
   *  the straight distance to target(). */
  range?: () => number;
  /** The frame clock (tests pass a fake); default requestAnimationFrame when there is one. */
  raf?: (f: () => void) => unknown;
};

type Voice = { osc: OscillatorNode; env: GainNode; panner: PannerNode; lp: BiquadFilterNode; next: number };
/** The hum: every source started once, at creation; only parameters move after that. */
type Hum = { srcs: AudioScheduledSourceNode[]; nodes: AudioNode[]; env: GainNode; am: GainNode; lfo: OscillatorNode; lfoAmt: GainNode;
  panner: PannerNode; lp: BiquadFilterNode; click: GainNode; nextWob: number; nextClick: number; aim: Vec2 | null; glideTo: number };

/** The scheduler: each animation frame (and a 40 ms interval) moves both panners and ramps the hum's parameters. */
export class ContinuousSounds {
  /** Explore's B toggles it; on by default. Rehearse leaves it alone, so back in Explore the choice is restored. */
  beaconOn = true;
  private beacon: Hum | null = null;
  /** A Rehearse B burst: its own hum, the aim point, pulses still to schedule, when it began. */
  private burstV: Hum | null = null;
  private burstState: { at: Vec2; left: number; t0: number; last: number } | null = null;
  private prox: Voice | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private framing = false;
  /** Counters for tests and the operator: beacon wobble cycles (and burst pulses), ticks scheduled, animation frames run. */
  pulses = 0;
  ticks = 0;
  frames = 0;
  /** The aim band of the hum right now (null: none yet), for tests and the observer. */
  lastCue: Cue | null = null;
  /** The hum's parameters last set (null: none yet), and where its source was last aimed. */
  lastHum: HumParams | null = null;
  lastSpot: Vec2 | null = null;

  constructor(private audio: AudioEngine, private world: World, private deps: ContinuousDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    (this.timer as any)?.unref?.();
    const raf = this.deps.raf ?? (typeof globalThis.requestAnimationFrame === "function" ? (f: () => void) => globalThis.requestAnimationFrame(f) : null);
    if (raf && !this.framing) {
      this.framing = true;
      const loop = (): void => { if (!this.timer) { this.framing = false; return; } this.frame(); raf(loop); };
      raf(loop);
    }
  }

  /** One animation frame: the audio listener to the ear pose, then a scheduler pass (moves the panners). */
  frame(): void {
    this.frames++;
    const e = (this.deps.ear ?? this.deps.pose)();
    this.audio.ear(e.pos, e.heading);
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.killHum(this.beacon); this.killHum(this.burstV); this.kill(this.prox);
    this.beacon = this.prox = this.burstV = null;
    this.burstState = null;
  }

  private kill(v: Voice | null): void {
    if (v) { try { v.env.gain.cancelScheduledValues?.(0); v.osc.stop(); v.osc.disconnect(); v.env.disconnect(); v.panner.disconnect(); v.lp.disconnect(); } catch { /* gone */ } }
  }

  private killHum(h: Hum | null): void {
    if (!h) return;
    for (const s of h.srcs) { try { s.stop(); } catch { /* gone */ } }
    for (const n of h.nodes) { try { n.disconnect(); } catch { /* gone */ } }
  }

  /** What the continuous beacon sounds like right now (aim band and ear side, from the same pure function the hum uses),
   *  or null while it is silent. The headless bot navigates by this alone. */
  hearing(): ReturnType<typeof heard> | null {
    if (!this.deps.live() || !this.beaconOn || this.deps.rehearse?.()) return null;
    const target = this.deps.target(), e = (this.deps.ear ?? this.deps.pose)();
    if (!target || dist(e.pos, target) <= BEACON_MUTE_M) return null;
    return heard(beaconAz(e.pos, e.heading, target));
  }

  /** True while the continuous hum exists (created on first need, kept alive, dropped in Rehearse). */
  get beaconRunning(): boolean { return !!this.beacon; }

  /** Stop the continuous beacon now (entering Rehearse). */
  silenceBeacon(): void { this.killHum(this.beacon); this.beacon = null; }

  /** True while a burst is playing or inside its hold time. */
  get bursting(): boolean {
    const b = this.burstState, c = this.audio.ctx;
    return !!b && !!c && c.currentTime < b.t0 + BURST_HOLD_S;
  }

  /** Rehearse B: BURST_PULSES swells of the hum from `at` (the path corner), then silence. False (ignored) during a burst. */
  burst(at: Vec2): boolean {
    const c = this.audio.ctx;
    if (!c || !this.audio.buses || this.bursting) return false;
    this.killHum(this.burstV); this.burstV = null;
    this.burstState = { at, left: BURST_PULSES, t0: c.currentTime, last: c.currentTime };
    this.tick();   // the first pulse answers the key at once
    return true;
  }

  /** The hum voice: detuned partials plus band-limited noise -> wobble (AM) -> level -> HRTF panner -> low-pass -> cue bus. */
  private hum(): Hum | null {
    const a = this.audio, c = a.ctx, b = a.buses;
    if (!c || !b) return null;
    const srcs: AudioScheduledSourceNode[] = [], nodes: AudioNode[] = [];
    const am = c.createGain(); am.gain.value = 1;
    const env = c.createGain(); env.gain.value = 0;
    const wsum = HUM_WEIGHTS.reduce((x, y) => x + y, 0) + NOISE_MIX;
    HUM_PARTIALS.forEach((hz, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = hz; o.detune.value = HUM_DETUNE[i];
      g.gain.value = HUM_WEIGHTS[i] / wsum;
      o.connect(g); g.connect(am); srcs.push(o); nodes.push(o, g);
    });
    // band-limited noise near 2.6 kHz, about 20% of the mix: one looping second of white noise through a band-pass
    const len = Math.max(1, Math.round(c.sampleRate));
    const buf = c.createBuffer(1, len, c.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = NOISE_HZ; bp.Q.value = 1.2;
    const ng = c.createGain(); ng.gain.value = NOISE_MIX / wsum;
    noise.connect(bp); bp.connect(ng); ng.connect(am); srcs.push(noise); nodes.push(noise, bp, ng);
    // the wobble: an LFO added to the AM gain (mean 1, swing +- depth/2)
    const lfo = c.createOscillator(), lfoAmt = c.createGain();
    lfo.type = "sine"; lfo.frequency.value = 1.5; lfoAmt.gain.value = 0.25;
    lfo.connect(lfoAmt); lfoAmt.connect(am.gain); srcs.push(lfo); nodes.push(lfo, lfoAmt);
    const chain = spatialChain(c, a.pose.pos, a.pose, { panning: a.panning, ref: BEACON_R_M, rolloff: 0 });
    am.connect(env); env.connect(chain.input); chain.output.connect(b.cue);
    // the on axis click: a short high sine through the same panner, gated by its own gain
    const co = c.createOscillator(), click = c.createGain();
    co.type = "sine"; co.frequency.value = CLICK_HZ; click.gain.value = 0;
    co.connect(click); click.connect(chain.input); srcs.push(co); nodes.push(co, click, am, env, chain.input, chain.output);
    for (const s of srcs) { try { s.start(); } catch { /* fake context */ } }
    return { srcs, nodes, env, am, lfo, lfoAmt, panner: chain.panner, lp: chain.output as BiquadFilterNode, click, nextWob: 0, nextClick: 0, aim: null, glideTo: 0 };
  }

  private place(v: Voice, at: Vec2, az: number, t: number, lpHz?: number): void {
    const [x, y, z] = toAudio(at);
    v.panner.positionX.setTargetAtTime(x, t, 0.02);
    v.panner.positionY.setTargetAtTime(y, t, 0.02);
    v.panner.positionZ.setTargetAtTime(z, t, 0.02);
    v.lp.frequency?.setTargetAtTime?.(lpHz ?? (Math.abs(az) > BEHIND_DEG ? 3500 : 18000), t, 0.05);
  }

  /** Aim the hum at `aim` (from the walker at pos, heard at ear heading) and ramp its parameters; `gate` false: the level
   *  is left to the caller (the burst). Returns the parameters and the panner spot. */
  private steer(h: Hum, aim: Vec2, pos: Vec2, earHeading: number, range: number, t: number, gate = true): { q: HumParams; spot: Vec2 } {
    if (h.aim && dist(h.aim, aim) > 1e-6) h.glideTo = t + GLIDE_S;   // a new corner: glide, never jump
    h.aim = [aim[0], aim[1]];
    const spot = beaconSpot(pos, aim), az = beaconAz(pos, earHeading, aim), q = humParams(az, range);
    const [x, y, z] = toAudio(spot), tc = t < h.glideTo ? GLIDE_S / 3 : 0.02, rc = RAMP_S / 3;
    h.panner.positionX.setTargetAtTime(x, t, tc);
    h.panner.positionY.setTargetAtTime(y, t, tc);
    h.panner.positionZ.setTargetAtTime(z, t, tc);
    h.lp.frequency?.setTargetAtTime?.(q.lpHz, t, rc);
    h.lfo.frequency.setTargetAtTime(q.rateHz, t, rc);
    h.lfoAmt.gain.setTargetAtTime(q.depth / 2, t, rc);
    if (gate) h.env.gain.setTargetAtTime(BEACON_GAIN * q.level, t, rc);
    this.lastCue = q.cue; this.lastHum = q; this.lastSpot = spot;
    return { q, spot };
  }

  /** One scheduler pass (public for tests). */
  tick(): void {
    const c = this.audio.ctx;
    if (!c || !this.audio.buses) return;
    const t = c.currentTime;
    const live = this.deps.live();
    const { pos, heading } = this.deps.pose();
    const ear = (this.deps.ear ?? this.deps.pose)();   // the beacon's direction follows the smoothed ear
    // ---- beacon (never in Rehearse: there must be nothing to home in on)
    const rehearse = !!this.deps.rehearse?.();
    if (rehearse && this.beacon) this.silenceBeacon();
    const target = live && this.beaconOn && !rehearse ? this.deps.target() : null;
    const d = target ? dist(pos, target) : Infinity;
    if (target && d > BEACON_MUTE_M) {
      const h = this.beacon ?? (this.beacon = this.hum());
      if (h) {
        const { q, spot } = this.steer(h, target, pos, ear.heading, this.deps.range?.() ?? d, t);
        if (h.nextWob < t) h.nextWob = t;
        while (h.nextWob < t + LOOKAHEAD_S) { this.pulses++; this.deps.onPulse?.(spot); h.nextWob += 1 / q.rateHz; }
        if (q.click) {
          if (h.nextClick < t) h.nextClick = t + 0.02;
          while (h.nextClick < t + LOOKAHEAD_S) {
            const s = h.nextClick, cg = h.click.gain, g = BEACON_GAIN * CLICK_LEVEL;
            cg.setValueAtTime(0, s); cg.linearRampToValueAtTime(g, s + 0.001); cg.setTargetAtTime(0, s + 0.002, CLICK_S / 3);
            h.nextClick += CLICK_EVERY_S;
          }
        } else h.nextClick = 0;
      }
    } else if (this.beacon) {   // silent but alive: fade the level, keep every source running
      this.beacon.env.gain.setTargetAtTime(0, t, RAMP_S / 3);
      this.beacon.nextWob = 0; this.beacon.nextClick = 0; this.beacon.aim = null;
    }
    // ---- a Rehearse B burst: a fixed count of swells of the hum, then the voice is dropped
    const b = this.burstState;
    if (b) {
      if (b.left > 0) {
        const h = this.burstV ?? (this.burstV = this.hum());
        if (h) {
          const { q, spot } = this.steer(h, b.at, pos, ear.heading, dist(pos, b.at), t, false);
          if (h.nextWob < t) h.nextWob = t + 0.02;
          while (b.left > 0 && h.nextWob < t + LOOKAHEAD_S) {
            const s = h.nextWob, p = h.env.gain, g = BEACON_GAIN * q.level;
            p.setValueAtTime(0, s); p.linearRampToValueAtTime(g, s + 0.03); p.setTargetAtTime(0, s + 0.15, 0.04);
            this.pulses++; this.deps.onPulse?.(spot);
            b.last = s; b.left--;
            h.nextWob += BURST_GAP_S;
          }
        } else b.left = 0;
      } else if (this.burstV && t > b.last + 0.4) { this.killHum(this.burstV); this.burstV = null; }
      if (b.left === 0 && !this.burstV && !this.bursting) this.burstState = null;
    }
    // ---- proximity
    const near = live ? nearestAhead(this.world, pos, heading) : null;
    const rate = proxRate(near?.dist);
    if (near && rate > 0) {
      const v = this.prox ?? (this.prox = this.voice());
      if (v) {
        this.place(v, near.at, near.az, t);
        if (v.next < t) v.next = t + 0.02;
        const g = proxGain(near.dist);
        while (v.next < t + LOOKAHEAD_S) {
          const p = v.env.gain, s = v.next;
          p.setValueAtTime(0, s); p.linearRampToValueAtTime(g, s + 0.003); p.setTargetAtTime(0, s + 0.006, 0.006);
          this.ticks++;
          v.next += 1 / rate;
        }
      }
    } else if (this.prox) this.prox.next = 0;
  }

  /** The obstacle tick's voice: lower and drier, a filtered square, no reverb send. */
  private voice(): Voice | null {
    const a = this.audio, c = a.ctx, b = a.buses;
    if (!c || !b) return null;
    const osc = c.createOscillator();
    const env = c.createGain(); env.gain.value = 0;
    const chain = spatialChain(c, a.pose.pos, a.pose, { panning: a.panning, ref: BEACON_R_M, rolloff: 0.6 });
    osc.type = "square"; osc.frequency.value = 160;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900; f.Q.value = 0.7;
    osc.connect(f); f.connect(env);
    env.connect(chain.input);
    chain.output.connect(b.cue);
    try { osc.start(); } catch { /* fake context */ }
    return { osc, env, panner: chain.panner, lp: chain.output as BiquadFilterNode, next: 0 };
  }
}
