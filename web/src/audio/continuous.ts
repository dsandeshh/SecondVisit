// The two continuous sounds (human decision 15 Nov 04:28): a soft target beacon from the target's true direction, and
// an obstacle proximity tick for the nearest solid thing in the 60 degree cone ahead within 3 m. They are the only two
// sounds that play without a key; each has one persistent HRTF chain (outside the one shot budget) that is moved every
// 40 ms, so the sound pans smoothly while the walker turns and walks. Both sit on the cue bus, so speech ducks them.
// Pure maths first (tested), the scheduler second.
import { ARRIVE_M } from "../config";
import type { Vec2 } from "../types";
import { bearing, dirOf, dist, wrap180, type World } from "../world";
import type { AudioEngine } from "./engine";
import { toAudio } from "./space";
import { BEHIND_DEG, spatialChain } from "./spatial";

export const BEACON_FAR_M = 10, BEACON_NEAR_M = 2, BEACON_SLOW_HZ = 1, BEACON_FAST_HZ = 4;
/** The beacon's panner sits this far from the walker, in the target's true direction: a steady level at any range. */
export const BEACON_R_M = 2;
export const BEACON_GAIN = 0.16;
export const PROX_M = 3, PROX_HALF_DEG = 30, PROX_SLOW_HZ = 2, PROX_FAST_HZ = 9;
export const PROX_GAIN = 0.22;
export const TICK_MS = 40;
/** Rehearse B (human decision 15 Nov): exactly this many beacon pulses from the destination, this far apart, then
 *  silence; another B is ignored until BURST_HOLD_S after the burst began, so mashing B never becomes a beacon. */
export const BURST_PULSES = 3, BURST_GAP_S = 0.3, BURST_HOLD_S = 2;
const LOOKAHEAD_S = 0.12;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Beacon pulses per second: 1 beyond 10 m, 4 within 2 m, straight line in between. */
export function beaconRate(d: number): number {
  if (!Number.isFinite(d)) return BEACON_SLOW_HZ;
  const k = clamp01((BEACON_FAR_M - d) / (BEACON_FAR_M - BEACON_NEAR_M));
  return BEACON_SLOW_HZ + k * (BEACON_FAST_HZ - BEACON_SLOW_HZ);
}

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
  /** Called on every beacon pulse (the ring and the observer). */
  onPulse?: (at: Vec2) => void;
};

type Voice = { osc: OscillatorNode; env: GainNode; panner: PannerNode; lp: BiquadFilterNode; next: number };

/** The scheduler: a 40 ms interval moves both panners and schedules the next pulses on a running oscillator. */
export class ContinuousSounds {
  /** Explore's B toggles it; on by default. Rehearse leaves it alone, so back in Explore the choice is restored. */
  beaconOn = true;
  private beacon: Voice | null = null;
  /** A Rehearse B burst: its own voice, the destination, pulses still to schedule, when it began. */
  private burstV: Voice | null = null;
  private burstState: { at: Vec2; left: number; t0: number; last: number } | null = null;
  private prox: Voice | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Counters for tests and the operator: pulses and ticks scheduled. */
  pulses = 0;
  ticks = 0;

  constructor(private audio: AudioEngine, private world: World, private deps: ContinuousDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    (this.timer as any)?.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const v of [this.beacon, this.prox, this.burstV]) this.kill(v);
    this.beacon = this.prox = this.burstV = null;
    this.burstState = null;
  }

  private kill(v: Voice | null): void {
    if (v) { try { v.env.gain.cancelScheduledValues?.(0); v.osc.stop(); v.osc.disconnect(); v.env.disconnect(); v.panner.disconnect(); v.lp.disconnect(); } catch { /* gone */ } }
  }

  /** True while a continuous beacon source exists (it is created on the first pulse and dropped in Rehearse). */
  get beaconRunning(): boolean { return !!this.beacon; }

  /** Stop the continuous beacon now (entering Rehearse), pulses already scheduled included. */
  silenceBeacon(): void { this.kill(this.beacon); this.beacon = null; }

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

  private voice(kind: "beacon" | "prox"): Voice | null {
    const a = this.audio, c = a.ctx, b = a.buses;
    if (!c || !b) return null;
    const osc = c.createOscillator();
    const env = c.createGain(); env.gain.value = 0;
    const chain = spatialChain(c, a.pose.pos, a.pose, { panning: a.panning, ref: BEACON_R_M, rolloff: kind === "beacon" ? 0 : 0.6 });
    if (kind === "beacon") { osc.type = "sine"; osc.frequency.value = 740; osc.connect(env); }
    else {   // lower and drier: a filtered square, no reverb send
      osc.type = "square"; osc.frequency.value = 160;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900; f.Q.value = 0.7;
      osc.connect(f); f.connect(env);
    }
    env.connect(chain.input);
    chain.output.connect(b.cue);
    try { osc.start(); } catch { /* fake context */ }
    return { osc, env, panner: chain.panner, lp: chain.output as BiquadFilterNode, next: 0 };
  }

  private place(v: Voice, at: Vec2, az: number, t: number): void {
    const [x, y, z] = toAudio(at);
    v.panner.positionX.setTargetAtTime(x, t, 0.04);
    v.panner.positionY.setTargetAtTime(y, t, 0.04);
    v.panner.positionZ.setTargetAtTime(z, t, 0.04);
    v.lp.frequency?.setTargetAtTime?.(Math.abs(az) > BEHIND_DEG ? 3500 : 18000, t, 0.05);
  }

  /** One scheduler pass (public for tests). */
  tick(): void {
    const c = this.audio.ctx;
    if (!c || !this.audio.buses) return;
    const t = c.currentTime;
    const live = this.deps.live();
    const { pos, heading } = this.deps.pose();
    // ---- beacon (never in Rehearse: there must be nothing to home in on)
    const rehearse = !!this.deps.rehearse?.();
    if (rehearse && this.beacon) this.silenceBeacon();
    const target = live && this.beaconOn && !rehearse ? this.deps.target() : null;
    const d = target ? dist(pos, target) : Infinity;
    if (target && d > ARRIVE_M) {
      const v = this.beacon ?? (this.beacon = this.voice("beacon"));
      if (v) {
        const spot = beaconSpot(pos, target);
        this.place(v, spot, beaconAz(pos, heading, target), t);
        if (v.next < t) v.next = t + 0.02;
        while (v.next < t + LOOKAHEAD_S) {
          const p = v.env.gain, s = v.next;
          p.setValueAtTime(0, s); p.linearRampToValueAtTime(BEACON_GAIN, s + 0.015); p.setTargetAtTime(0, s + 0.04, 0.03);
          this.pulses++; this.deps.onPulse?.(spot);
          v.next += 1 / beaconRate(d);
        }
      }
    } else if (this.beacon) this.beacon.next = 0;
    // ---- a Rehearse B burst: a fixed count of pulses, then the voice is dropped
    const b = this.burstState;
    if (b) {
      if (b.left > 0) {
        const v = this.burstV ?? (this.burstV = this.voice("beacon"));
        if (v) {
          const spot = beaconSpot(pos, b.at);
          this.place(v, spot, beaconAz(pos, heading, b.at), t);
          if (v.next < t) v.next = t + 0.02;
          while (b.left > 0 && v.next < t + LOOKAHEAD_S) {
            const p = v.env.gain, s = v.next;
            p.setValueAtTime(0, s); p.linearRampToValueAtTime(BEACON_GAIN, s + 0.015); p.setTargetAtTime(0, s + 0.04, 0.03);
            this.pulses++; this.deps.onPulse?.(spot);
            b.last = s; b.left--;
            v.next += BURST_GAP_S;
          }
        } else b.left = 0;
      } else if (this.burstV && t > b.last + 0.3) { this.kill(this.burstV); this.burstV = null; }
      if (b.left === 0 && !this.burstV && !this.bursting) this.burstState = null;
    }
    // ---- proximity
    const near = live ? nearestAhead(this.world, pos, heading) : null;
    const rate = proxRate(near?.dist);
    if (near && rate > 0) {
      const v = this.prox ?? (this.prox = this.voice("prox"));
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
}
