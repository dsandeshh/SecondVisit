// The two continuous sounds (human decision 15 Nov 04:28; the beacon a continuous hum since 06:30): a hum from the next
// corner of the walkable path to the target (beacon_cue.humParams: wobble rate = distance, brightness = aim), and
// a low obstacle drone (80 + 160 Hz under a 300 Hz low-pass) from the nearest solid thing in the 60 degree cone ahead
// within 2.5 m, rising to clear at 0.5 m and throbbing slowly inside 1 m; never a tick or any other transient. They are the only two
// sounds that play without a key; each has one persistent HRTF chain (outside the one shot budget) that is moved every
// animation frame (~60 fps, a 40 ms interval as the fallback) from the walker's pose with the smoothed ear heading, so the
// sound sweeps while the walker turns and walks. Both sit on the cue bus, so speech ducks them. The beacon's sound model
// (on axis click and pitch, behind low-pass, rate by distance) is beacon_cue.ts.
// Pure maths first (tested), the scheduler second.
import type { Vec2 } from "../types";
import { bearing, dirOf, dist, wrap180, type World } from "../world";
import type { AudioEngine } from "./engine";
import { toAudio } from "./space";
import { BEHIND_DEG, spatialChain } from "./spatial";
import { CLICK_HZ, CLICK_S, cueParams, heard, HUM_CLICK_LEVEL, HUM_CLICK_PER_S, HUM_GLIDE_TAU, HUM_NOISE_HZ, HUM_NOISE_LEVEL,
  HUM_NOISE_Q, HUM_PARTIALS, HUM_RAMP_TAU, humParams, pulseRate, type Cue, type HumParams } from "./beacon_cue";

export const BEACON_FAR_M = 10, BEACON_NEAR_M = 2, BEACON_SLOW_HZ = 1, BEACON_FAST_HZ = 4;
/** The beacon's panner sits this far from the walker, in the target's true direction: a steady level at any range. */
export const BEACON_R_M = 2;
export const BEACON_GAIN = 0.16;
export const PROX_M = 2.5, PROX_HALF_DEG = 30;
/** The obstacle drone: sine partials (Hz, level) only, a low-pass well under the beacon, its level at 0.5 m and nearer
 *  about 6 dB under the beacon's (so the beacon stays the loudest sound that is not speech). */
export const DRONE_PARTIALS: { hz: number; level: number }[] = [{ hz: 80, level: 1 }, { hz: 160, level: 0.5 }];
export const DRONE_LP_HZ = 300, DRONE_CLEAR_M = 0.5;
export const DRONE_GAIN = BEACON_GAIN * 10 ** (-6 / 20);
/** Inside THROB_M the drone's level throbs at THROB_HZ (an LFO on its gain), deepening to THROB_DEPTH at 0.5 m. */
export const THROB_M = 1, THROB_HZ = 4, THROB_DEPTH = 0.5;
export const TICK_MS = 40;
/** Rehearse B (human decision 15 Nov): exactly this many beacon pulses from the destination, this far apart, then
 *  silence; another B is ignored until BURST_HOLD_S after the burst began, so mashing B never becomes a beacon. */
export const BURST_PULSES = 3, BURST_GAP_S = 0.3, BURST_HOLD_S = 2;
const LOOKAHEAD_S = 0.12;
/** The beacon keeps pulsing until the target says it is reached (the 1 m arrival stops it by clearing target());
 *  only this close to the point it sounds from does it fall silent (no direction left to give). */
export const BEACON_MUTE_M = 0.3;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Beacon pulses per second: 1 beyond 10 m, 2 at 5 m, 4 within 2 m (beacon_cue.pulseRate). */
export const beaconRate = pulseRate;

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

const smooth = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k); };
const far = (d: number | null | undefined): d is null | undefined => d === null || d === undefined || !Number.isFinite(d) || d > PROX_M;

/** The drone's level: 0 beyond 2.5 m or with nothing ahead, rising smoothly to DRONE_GAIN at 0.5 m and nearer. */
export function droneGain(d: number | null | undefined): number {
  if (far(d)) return 0;
  return DRONE_GAIN * smooth((PROX_M - d) / (PROX_M - DRONE_CLEAR_M));
}

/** The throb's depth (0..1 of the level): 0 at 1 m and beyond, rising smoothly to THROB_DEPTH at 0.5 m and nearer. */
export function throbDepth(d: number | null | undefined): number {
  if (far(d) || d >= THROB_M) return 0;
  return THROB_DEPTH * smooth((THROB_M - d) / (THROB_M - DRONE_CLEAR_M));
}

export type ContinuousDeps = {
  pose: () => { pos: Vec2; heading: number };
  /** The beacon target, or null (no target: the beacon is silent). */
  target: () => Vec2 | null;
  /** False while the walker cannot walk (pointing, quiz, summary, another page): both sounds are silent. */
  live: () => boolean;
  /** True in Rehearse: the continuous beacon never plays (only a B burst does). */
  rehearse?: () => boolean;
  /** Called on every beacon pulse (the ring and the observer). */
  onPulse?: (at: Vec2) => void;
  /** The ear: the walker's position with the smoothed heading (mid turn); the beacon's direction and the audio listener
   *  follow it. Default: pose. */
  ear?: () => { pos: Vec2; heading: number };
  /** The frame clock (tests pass a fake); default requestAnimationFrame when there is one. */
  raf?: (f: () => void) => unknown;
};

/** The continuous hum: every node made once, started once, then only its parameters move. */
type Hum = { srcs: (OscillatorNode | AudioBufferSourceNode)[]; nodes: AudioNode[]; lfo: OscillatorNode; lfoDepth: GainNode;
  am: GainNode; level: GainNode; panner: PannerNode; lp: BiquadFilterNode; click: { osc: OscillatorNode; env: GainNode };
  nextClick: number; phase: number; lastT: number; at: Vec2 | null };

/** The obstacle drone, built and started once: sines -> 300 Hz low-pass -> throb gain (4 Hz LFO) -> level -> HRTF. */
type Drone = { srcs: OscillatorNode[]; nodes: AudioNode[]; lfo: OscillatorNode; lfoDepth: GainNode; am: GainNode;
  level: GainNode; panner: PannerNode; lp: BiquadFilterNode; at: Vec2 | null };

type Voice = { osc: OscillatorNode; env: GainNode; panner: PannerNode; lp: BiquadFilterNode; next: number;
  click?: { osc: OscillatorNode; env: GainNode } };

/** The scheduler: a 40 ms interval moves both panners and schedules the next pulses on a running oscillator. */
export class ContinuousSounds {
  /** Explore's B toggles it; on by default. Rehearse leaves it alone, so back in Explore the choice is restored. */
  beaconOn = true;
  private beacon: Hum | null = null;
  /** A Rehearse B burst: its own voice, the destination, pulses still to schedule, when it began. */
  private burstV: Voice | null = null;
  private burstState: { at: Vec2; left: number; t0: number; last: number } | null = null;
  private drone: Drone | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private framing = false;
  /** Counters for tests and the operator: pulses scheduled, animation frames run. */
  pulses = 0;
  frames = 0;
  /** The cue of the last beacon pulse scheduled (null: none yet), for tests and the observer. */
  lastCue: Cue | null = null;
  /** The hum's parameters on the last frame (null: silent), for tests and the observer. */
  lastHum: (HumParams & { az: number; d: number; at: Vec2 }) | null = null;
  /** Source nodes the hum has created and started (tests: it is made once, never restarted). */
  humStarts = 0;
  /** Source nodes the obstacle drone has created and started (made once, never restarted). */
  droneStarts = 0;
  /** The drone on the last pass: its distance (null: nothing within 2.5 m), level and throb depth. */
  lastDrone: { d: number | null; gain: number; throb: number; at: Vec2 | null } | null = null;

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
    this.killHum();
    this.kill(this.burstV);
    const dr = this.drone;
    if (dr) { try { for (const n of [...dr.srcs, dr.lfo]) n.stop(); for (const n of dr.nodes) n.disconnect(); } catch { /* gone */ } }
    this.beacon = this.drone = this.burstV = null;
    this.burstState = null;
  }

  private kill(v: Voice | null): void {
    if (v) { try { v.env.gain.cancelScheduledValues?.(0); v.osc.stop(); v.osc.disconnect(); v.env.disconnect(); v.panner.disconnect(); v.lp.disconnect(); v.click?.osc.stop(); v.click?.osc.disconnect(); v.click?.env.disconnect(); } catch { /* gone */ } }
  }

  private killHum(): void {
    const h = this.beacon;
    if (h) { try { for (const n of [...h.srcs, h.lfo, h.click.osc]) n.stop(); for (const n of h.nodes) n.disconnect(); } catch { /* gone */ } }
    this.beacon = null;
  }

  /** What the continuous hum sounds like right now (ear side, brightness, wobble, from the same pure function the hum
   *  plays), or null while it is silent. The headless bot navigates by this alone. */
  hearing(): (ReturnType<typeof heard> & HumParams) | null {
    if (!this.deps.live() || !this.beaconOn || this.deps.rehearse?.()) return null;
    const target = this.deps.target(), e = (this.deps.ear ?? this.deps.pose)();
    if (!target || dist(e.pos, target) <= BEACON_MUTE_M) return null;
    const az = beaconAz(e.pos, e.heading, target);
    return { ...humParams(az, dist(e.pos, target)), ...heard(az) };
  }

  /** True while a continuous beacon source exists (it is created on the first pulse and dropped in Rehearse). */
  get beaconRunning(): boolean { return !!this.beacon; }

  /** Stop the continuous beacon now (entering Rehearse), pulses already scheduled included. */
  silenceBeacon(): void { this.killHum(); }

  /** True while a burst is playing or inside its hold time. */
  get bursting(): boolean {
    const b = this.burstState, c = this.audio.ctx;
    return !!b && !!c && c.currentTime < b.t0 + BURST_HOLD_S;
  }

  /** Rehearse B: BURST_PULSES pulses from `at` (its true direction), then silence. False (ignored) during a burst. */
  burst(at: Vec2): boolean {
    const c = this.audio.ctx;
    if (!c || !this.audio.buses || this.bursting) return false;
    this.kill(this.burstV); this.burstV = null;
    this.burstState = { at, left: BURST_PULSES, t0: c.currentTime, last: c.currentTime };
    this.tick();   // the first pulse answers the key at once
    return true;
  }

  /** A Rehearse burst's pulse voice (a sine plus the on axis click, through one HRTF panner). */
  private voice(): Voice | null {
    const a = this.audio, c = a.ctx, b = a.buses;
    if (!c || !b) return null;
    const osc = c.createOscillator();
    const env = c.createGain(); env.gain.value = 0;
    const chain = spatialChain(c, a.pose.pos, a.pose, { panning: a.panning, ref: BEACON_R_M, rolloff: 0 });
    osc.type = "sine"; osc.frequency.value = 740; osc.connect(env);
    env.connect(chain.input);
    chain.output.connect(b.cue);
    try { osc.start(); } catch { /* fake context */ }
    const co = c.createOscillator(), ce = c.createGain();   // the on axis click: a short high sine through the same panner
    co.type = "sine"; co.frequency.value = CLICK_HZ; ce.gain.value = 0;
    co.connect(ce); ce.connect(chain.input);
    try { co.start(); } catch { /* fake context */ }
    return { osc, env, panner: chain.panner, lp: chain.output as BiquadFilterNode, next: 0, click: { osc: co, env: ce } };
  }

  /** The obstacle drone, built and started once (silent until something is within 2.5 m ahead). */
  private makeDrone(): Drone | null {
    const a = this.audio, c = a.ctx, b = a.buses;
    if (!c || !b) return null;
    const chain = spatialChain(c, a.pose.pos, a.pose, { panning: a.panning, ref: BEACON_R_M, rolloff: 0 });
    const mix = c.createGain(), lp = c.createBiquadFilter(), am = c.createGain(), level = c.createGain();
    lp.type = "lowpass"; lp.frequency.value = DRONE_LP_HZ; lp.Q.value = 0.7;
    level.gain.value = 0; am.gain.value = 1;
    const norm = 1 / DRONE_PARTIALS.reduce((s, p) => s + p.level, 0);
    const srcs: OscillatorNode[] = [], nodes: AudioNode[] = [mix, lp, am, level, chain.panner, chain.output];
    for (const p of DRONE_PARTIALS) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = p.hz; g.gain.value = p.level * norm;
      o.connect(g); g.connect(mix); srcs.push(o); nodes.push(o, g);
    }
    const lfo = c.createOscillator(), lfoDepth = c.createGain();
    lfo.type = "sine"; lfo.frequency.value = THROB_HZ; lfoDepth.gain.value = 0;
    lfo.connect(lfoDepth); lfoDepth.connect(am.gain); nodes.push(lfo, lfoDepth);
    mix.connect(lp); lp.connect(am); am.connect(level); level.connect(chain.input); chain.output.connect(b.cue);
    for (const n of [...srcs, lfo]) { try { n.start(); } catch { /* fake context */ } this.droneStarts++; }
    return { srcs, nodes, lfo, lfoDepth, am, level, panner: chain.panner, lp, at: null };
  }

  /** The hum, built and started once: partials and noise -> AM gain (an LFO on its gain) -> level -> HRTF panner -> low-pass. */
  private hum(): Hum | null {
    const a = this.audio, c = a.ctx, b = a.buses;
    if (!c || !b) return null;
    const chain = spatialChain(c, a.pose.pos, a.pose, { panning: a.panning, ref: BEACON_R_M, rolloff: 0 });
    const lp = chain.output as BiquadFilterNode;
    const am = c.createGain(), level = c.createGain(), mix = c.createGain();
    level.gain.value = 0;
    const norm = 1 / HUM_PARTIALS.reduce((s, p) => s + p.level, 0);
    const srcs: Hum["srcs"] = [], nodes: AudioNode[] = [mix, am, level, chain.panner, lp];
    for (const p of HUM_PARTIALS) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = p.hz; o.detune.value = p.cents; g.gain.value = p.level * norm;
      o.connect(g); g.connect(mix); srcs.push(o); nodes.push(o, g);
    }
    const len = Math.round(c.sampleRate * 2), buf = c.createBuffer(1, len, c.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
    noise.buffer = buf; noise.loop = true; bp.type = "bandpass"; bp.frequency.value = HUM_NOISE_HZ; bp.Q.value = HUM_NOISE_Q;
    ng.gain.value = HUM_NOISE_LEVEL;
    noise.connect(bp); bp.connect(ng); ng.connect(mix); srcs.push(noise); nodes.push(noise, bp, ng);
    const lfo = c.createOscillator(), lfoDepth = c.createGain();
    lfo.type = "sine"; lfo.frequency.value = 1.5; lfoDepth.gain.value = 0.25; am.gain.value = 0.75;
    lfo.connect(lfoDepth); lfoDepth.connect(am.gain); nodes.push(lfo, lfoDepth);
    mix.connect(am); am.connect(level); level.connect(chain.input); lp.connect(b.cue);
    const co = c.createOscillator(), ce = c.createGain();
    co.type = "sine"; co.frequency.value = CLICK_HZ; ce.gain.value = 0;
    co.connect(ce); ce.connect(chain.input); nodes.push(co, ce);
    for (const n of [...srcs, lfo, co]) { try { n.start(); } catch { /* fake context */ } this.humStarts++; }
    return { srcs, nodes, lfo, lfoDepth, am, level, panner: chain.panner, lp, click: { osc: co, env: ce }, nextClick: 0, phase: 0,
      lastT: c.currentTime, at: null };
  }

  /** One frame of the hum: glide the source to `at`, ramp brightness, wobble and level (every change ~80 ms). */
  private humFrame(h: Hum, at: Vec2, q: HumParams, t: number): void {
    const [x, y, z] = toAudio(at);
    const glide = h.at ? HUM_GLIDE_TAU : 0.005;   // the first placement is immediate, every later move a ~250 ms glide
    h.panner.positionX.setTargetAtTime(x, t, glide);
    h.panner.positionY.setTargetAtTime(y, t, glide);
    h.panner.positionZ.setTargetAtTime(z, t, glide);
    h.at = [at[0], at[1]];
    h.lp.frequency.setTargetAtTime(q.lpHz, t, HUM_RAMP_TAU);
    h.lfo.frequency.setTargetAtTime(q.rateHz, t, HUM_RAMP_TAU);
    h.lfoDepth.gain.setTargetAtTime(q.depth / 2, t, HUM_RAMP_TAU);   // the gain swings 1 - depth .. 1
    h.am.gain.setTargetAtTime(1 - q.depth / 2, t, HUM_RAMP_TAU);
    h.level.gain.setTargetAtTime(BEACON_GAIN * q.level, t, HUM_RAMP_TAU);
    if (q.click && h.nextClick <= t + LOOKAHEAD_S) {
      const s = Math.max(t + 0.02, h.nextClick), g = h.click.env.gain;
      g.setValueAtTime(0, s); g.linearRampToValueAtTime(BEACON_GAIN * HUM_CLICK_LEVEL, s + 0.001); g.setTargetAtTime(0, s + 0.002, CLICK_S / 3);
      h.nextClick = s + 1 / HUM_CLICK_PER_S;
    }
    // one wobble cycle = one "pulse" for the ring and the observer
    h.phase += Math.max(0, t - h.lastT) * q.rateHz; h.lastT = t;
    if (h.phase >= 1 || this.pulses === 0) { h.phase %= 1; this.pulses++; this.deps.onPulse?.(at); }
  }

  private place(v: Voice, at: Vec2, az: number, t: number, lpHz?: number): void {
    const [x, y, z] = toAudio(at);
    v.panner.positionX.setTargetAtTime(x, t, 0.02);
    v.panner.positionY.setTargetAtTime(y, t, 0.02);
    v.panner.positionZ.setTargetAtTime(z, t, 0.02);
    v.lp.frequency?.setTargetAtTime?.(lpHz ?? (Math.abs(az) > BEHIND_DEG ? 3500 : 18000), t, 0.05);
  }

  /** One beacon pulse at time s, shaped by the cue at azimuth az (beacon_cue.ts). Returns the rate factor. */
  private pulse(v: Voice, s: number, az: number): number {
    const q = cueParams(az);
    this.lastCue = q.cue;
    v.osc.frequency.setValueAtTime?.(q.hz, s);
    const p = v.env.gain, g = BEACON_GAIN * q.level;
    p.setValueAtTime(0, s); p.linearRampToValueAtTime(g, s + 0.015); p.setTargetAtTime(0, s + 0.04, 0.03);
    if (v.click && q.click > 0) {
      const cg = v.click.env.gain;
      cg.setValueAtTime(0, s); cg.linearRampToValueAtTime(g * q.click, s + 0.001); cg.setTargetAtTime(0, s + 0.002, CLICK_S / 3);
    }
    return q.rateK;
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
        const az = beaconAz(pos, ear.heading, target), q = humParams(az, d);
        this.lastCue = q.cue; this.lastHum = { ...q, az, d, at: target };
        this.humFrame(h, target, q, t);
      }
    } else {
      this.lastHum = null;
      if (this.beacon) { this.beacon.level.gain.setTargetAtTime(0, t, HUM_RAMP_TAU); this.beacon.lastT = t; }
    }
    // ---- a Rehearse B burst: a fixed count of pulses, then the voice is dropped
    const b = this.burstState;
    if (b) {
      if (b.left > 0) {
        const v = this.burstV ?? (this.burstV = this.voice());
        if (v) {
          const spot = beaconSpot(pos, b.at), az = beaconAz(pos, ear.heading, b.at);
          this.place(v, spot, az, t, cueParams(az).lpHz);
          if (v.next < t) v.next = t + 0.02;
          while (b.left > 0 && v.next < t + LOOKAHEAD_S) {
            const s = v.next;
            this.pulse(v, s, az);
            this.pulses++; this.deps.onPulse?.(spot);
            b.last = s; b.left--;
            v.next += BURST_GAP_S;
          }
        } else b.left = 0;
      } else if (this.burstV && t > b.last + 0.3) { this.kill(this.burstV); this.burstV = null; }
      if (b.left === 0 && !this.burstV && !this.bursting) this.burstState = null;
    }
    // ---- the obstacle drone: made once, then only its position, level and throb move (every change ~80 ms)
    const dr = this.drone ?? (this.drone = this.makeDrone());
    if (dr) {
      const near = live ? nearestAhead(this.world, pos, heading) : null;
      const d = near ? near.dist : null, g = droneGain(d), k = throbDepth(d);
      if (near && g > 0) {
        const [x, y, z] = toAudio(near.at), glide = dr.at ? HUM_RAMP_TAU : 0.005;
        dr.panner.positionX.setTargetAtTime(x, t, glide);
        dr.panner.positionY.setTargetAtTime(y, t, glide);
        dr.panner.positionZ.setTargetAtTime(z, t, glide);
        dr.at = [near.at[0], near.at[1]];
      }
      dr.level.gain.setTargetAtTime(g, t, HUM_RAMP_TAU);
      dr.lfoDepth.gain.setTargetAtTime(k / 2, t, HUM_RAMP_TAU);   // the gain swings 1 - depth .. 1: the peak stays g
      dr.am.gain.setTargetAtTime(1 - k / 2, t, HUM_RAMP_TAU);
      this.lastDrone = { d: g > 0 ? d : null, gain: g, throb: k, at: g > 0 && near ? near.at : null };
    }
  }
}
