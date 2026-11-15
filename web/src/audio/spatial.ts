// Spatial audio shared by every positioned sound (review/agent5_interaction.md 4.2): one HRTF PannerNode chain,
// inverse distance, refDistance 1, rolloff 0.6, an extra lowpass behind the listener, and the budget of two
// HRTF sounds at once. Plan metres in, Web Audio coordinates out (toAudio, ear plane, no elevation).
import type { Vec2 } from "../types";
import { azimuth, toAudio } from "./space";

export const ROLLOFF = 0.6;
export const MAX_HRTF = 2;
export const BEHIND_DEG = 100;

export type Pose = { pos: Vec2; heading: number };
export type ChainOpts = { rolloff?: number; ref?: number; panning?: PanningModelType };

/** panner -> lowpass (3.5 kHz when the source is behind the listener, open otherwise). */
export function spatialChain(ctx: BaseAudioContext, at: Vec2, l: Pose, opts: ChainOpts = {}):
  { input: AudioNode; output: AudioNode; panner: PannerNode } {
  const [x, y, z] = toAudio(at);
  const panner = ctx.createPanner();
  panner.panningModel = opts.panning ?? "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = opts.ref ?? 1;
  panner.rolloffFactor = opts.rolloff ?? ROLLOFF;
  panner.maxDistance = 40;
  panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.Q.value = 0.7;
  lp.frequency.value = Math.abs(azimuth(l.pos, l.heading, at)) > BEHIND_DEG ? 3500 : 18000;
  panner.connect(lp);
  return { input: panner, output: lp, panner };
}

/** The most HRTF sounds that may play at once; a higher priority evicts the lowest, equal or lower is refused. */
export class HrtfBudget {
  private active: { pri: number; stop: () => void }[] = [];
  constructor(readonly max = MAX_HRTF) {}
  get count(): number { return this.active.length; }
  /** Returns a release function, or null when the sound may not be positioned. `stop` is called if it is evicted. */
  acquire(pri: number, stop: () => void): (() => void) | null {
    if (this.active.length >= this.max) {
      const low = this.active.reduce((a, b) => (b.pri < a.pri ? b : a));
      if (low.pri >= pri) return null;
      this.active.splice(this.active.indexOf(low), 1);
      try { low.stop(); } catch { /* already gone */ }
    }
    const e = { pri, stop };
    this.active.push(e);
    return () => { const i = this.active.indexOf(e); if (i >= 0) this.active.splice(i, 1); };
  }
}
