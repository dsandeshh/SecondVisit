// Landmark sounds: only kinds that sound in the real place, nearest two within 6 m (agent3 3.3).
import type { Landmark, LandmarkKind, Vec2 } from "../types";
import { dist } from "../world";
import { toAudio } from "./space";

export const SOUNDING: Partial<Record<LandmarkKind, { everyS: [number, number] }>> = {
  desk: { everyS: [1.5, 3] },     // soft typing and murmur
  elevator: { everyS: [6, 6] },   // ding
  water: { everyS: [1.5, 2] },    // fountain hum
};

export type AudibleOpts = { max: number; radiusM: number; includeDestination: boolean; destinationId?: string };

export function audible(landmarks: Landmark[], pos: Vec2, _heading: number, opts: AudibleOpts): Landmark[] {
  return landmarks
    .filter(l => SOUNDING[l.kind] && (opts.includeDestination || l.id !== opts.destinationId))
    .map(l => ({ l, d: dist(pos, l.pos) }))
    .filter(x => x.d <= opts.radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, opts.max)
    .map(x => x.l);
}

type Voice = { panner: PannerNode; timer: ReturnType<typeof setTimeout> | null };

/** Plays intermittent 200 ms events through HRTF panners; panners beyond the budget are disconnected. */
export class LandmarkSounds {
  private voices = new Map<string, Voice>();
  constructor(private ctx: AudioContext, private out: AudioNode, private destinationId?: string,
    private panning: PanningModelType = "HRTF") {}

  update(all: Landmark[], pos: Vec2, heading: number, includeDestination: boolean): void {
    const keep = audible(all, pos, heading, { max: 2, radiusM: 6, includeDestination, destinationId: this.destinationId });
    const ids = new Set(keep.map(l => l.id));
    for (const [id, v] of this.voices) if (!ids.has(id)) { this.stopVoice(v); this.voices.delete(id); }
    for (const l of keep) if (!this.voices.has(l.id)) this.voices.set(l.id, this.startVoice(l));
  }

  stop(): void { for (const v of this.voices.values()) this.stopVoice(v); this.voices.clear(); }

  /** Three chirps from a point (key B destination hint). */
  chirps(at: Vec2): void {
    const p = this.panner(at);
    for (let i = 0; i < 3; i++) this.blip(p, "chirp", this.ctx.currentTime + i * 0.25);
    setTimeout(() => p.disconnect(), 1500);
  }

  private panner(at: Vec2): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = this.panning; p.distanceModel = "inverse"; p.refDistance = 1; p.rolloffFactor = 1;
    const [x, y, z] = toAudio(at);
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    p.connect(this.out);
    return p;
  }

  private startVoice(l: Landmark): Voice {
    const v: Voice = { panner: this.panner(l.pos), timer: null };
    const [lo, hi] = SOUNDING[l.kind]!.everyS;
    const tick = () => {
      this.blip(v.panner, l.kind, this.ctx.currentTime + 0.01);
      v.timer = setTimeout(tick, 1000 * (lo + Math.random() * (hi - lo)));
    };
    v.timer = setTimeout(tick, 200 + Math.random() * 600);
    return v;
  }

  private stopVoice(v: Voice): void { if (v.timer) clearTimeout(v.timer); v.panner.disconnect(); }

  /** A distinct short event per kind: broadband transients localise better than sine tones. */
  private blip(to: AudioNode, kind: string, t: number): void {
    const c = this.ctx, g = c.createGain();
    g.connect(to);
    if (kind === "elevator" || kind === "chirp") {
      const o = c.createOscillator();
      o.type = kind === "chirp" ? "square" : "sine";
      o.frequency.setValueAtTime(kind === "chirp" ? 2400 : 1318, t);
      if (kind === "chirp") o.frequency.exponentialRampToValueAtTime(3600, t + 0.08);
      const len = kind === "chirp" ? 0.09 : 0.6;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === "chirp" ? 0.25 : 0.4, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); o.start(t); o.stop(t + len + 0.05);
      return;
    }
    // desk: a few key clicks; water: a short band of hiss
    const n = kind === "desk" ? 4 : 1;
    for (let i = 0; i < n; i++) {
      const s = c.createBufferSource(), f = c.createBiquadFilter();
      s.buffer = noise(c, kind === "desk" ? 0.012 : 0.25);
      f.type = "bandpass"; f.frequency.value = kind === "desk" ? 3200 + Math.random() * 800 : 600; f.Q.value = kind === "desk" ? 3 : 0.7;
      const at = t + i * (0.09 + Math.random() * 0.06);
      const gg = c.createGain(); gg.gain.value = kind === "desk" ? 0.5 : 0.25;
      s.connect(f).connect(gg).connect(g); s.start(at);
    }
    g.gain.value = 1;
  }
}

const cache = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();
function noise(c: BaseAudioContext, sec: number): AudioBuffer {
  let m = cache.get(c); if (!m) cache.set(c, (m = new Map()));
  let b = m.get(sec);
  if (!b) {
    b = c.createBuffer(1, Math.max(1, Math.round(sec * c.sampleRate)), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    m.set(sec, b);
  }
  return b;
}
