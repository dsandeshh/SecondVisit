// Audio engine: the Start sequence (iOS, Android, desktop) and the master chain (agent3 1.1, 1.9).
// sources -> ducking gains -> channel swap (S) / mono (M) -> limiter -> destination.
import { CueBus, type BusName } from "../events";
import type { Vec2 } from "../types";
import { firstRealOrientation, modeFor, requestMotion, type InputMode, type Motion } from "../input/orientation";
import { Echo } from "./echo";
import { tapGain } from "./cane";
import { placeListener } from "./space";
import { HrtfBudget, spatialChain } from "./spatial";
import type { Output, Speech } from "./speech";
import { renderTaps, type TapKind } from "./taps";

export type StartReport = { audio: "running" | "failed"; motion: Motion; vibrate: boolean; latencyMs: number };

const latencyOf = (c: AudioContext) =>
  Math.round(1000 * ((c.baseLatency ?? 0) + ((c as any).outputLatency ?? 0)));

const dbToGain = (db: number) => Math.pow(10, db / 20);
/** Bus levels (agent5 4.2) and how far speech ducks each (safety never below -4 dB). */
export const BUS_LEVEL: Record<BusName, number> = {
  voice: 1, cue: dbToGain(-6), safety: 1, ambient: dbToGain(-18), footsteps: dbToGain(-8),
};
export const BUS_DUCK: Record<BusName, number> = {
  voice: 1, cue: dbToGain(-10), safety: dbToGain(-4), ambient: dbToGain(-6), footsteps: 1,
};
const REVERB_SEND = dbToGain(-10);

export type PlayOpts = {
  bus: BusName; at?: Vec2; pri?: number; gain?: number; rate?: number; send?: number; label?: string;
  /** Publish a `sound` cue for the ring (speech lines are announced by their own `say` cue). */
  announce?: boolean; spatialOnly?: boolean; sound?: string; onEnd?: () => void; panning?: PanningModelType;
};
export type Playing = { stop(): void; spatial: boolean };

export class AudioEngine {
  ctx: AudioContext | null = null;
  mode: InputMode = "keys";
  report: StartReport | null = null;
  mono = false;
  swapped = false;
  taps: Record<TapKind, AudioBuffer> | null = null;
  echo: Echo | null = null;
  buses: Record<BusName, GainNode> | null = null;
  /** Aliases kept for the older callers: taps are the safety bus, beacons the cue bus. */
  tapBus: GainNode | null = null;
  beaconBus: GainNode | null = null;
  readonly budget = new HrtfBudget();
  readonly bus: CueBus;
  pose: { pos: Vec2; heading: number } = { pos: [0, 0], heading: 0 };
  onPause: () => void = () => {};
  onResume: () => void = () => {};
  private matrix: GainNode[] = []; // LL, LR, RL, RR
  private resumeArmed = false;

  constructor(readonly speech: Speech) {
    this.bus = speech.bus;
    speech.onDuck = (on) => this.duck(on);
  }

  /**
   * Call synchronously from the Start (mode choice) click. Everything that needs the gesture happens
   * before the first await: audio session, AudioContext, unlock buffer, speech prime, motion permission.
   */
  async start(output: Output, motionWaitMs = 1000): Promise<StartReport> {
    const nav = navigator as any;
    this.speech.setOutput(output);
    if (nav.audioSession) { try { nav.audioSession.type = "playback"; } catch { /* old iOS */ } }
    const AC: typeof AudioContext = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    const ctx = new AC({ latencyHint: "interactive" });
    this.ctx = ctx;
    const resumed = Promise.resolve(ctx.resume()).catch(() => undefined);
    try {
      const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      s.connect(ctx.destination); s.start();
    } catch { /* fake or closed context */ }
    this.speech.prime("Starting.");
    const perm = requestMotion();
    const wake = nav.wakeLock?.request?.("screen")?.catch?.(() => null) ?? Promise.resolve(null);
    const [, p] = await Promise.all([resumed, perm, wake]); // first await
    const motion: Motion = p === "granted" ? await firstRealOrientation(motionWaitMs) : p;
    this.build(ctx);
    ctx.onstatechange = () => { if (ctx.state !== "running") this.onAudioPaused(); };
    this.mode = modeFor(motion);
    this.report = { audio: ctx.state === "running" ? "running" : "failed", motion,
      vibrate: "vibrate" in navigator && typeof nav.vibrate === "function", latencyMs: latencyOf(ctx) };
    return this.report;
  }

  statusLine(r: StartReport): string {
    const sound = r.audio === "running" ? "Sound on." : "Sound did not start. Press Space or tap to try again.";
    let motion: string;
    if (this.mode === "motion") motion = "Motion on. Hold the phone flat, top edge forward. Turn your body to turn.";
    else if (this.mode === "touch") motion = "Motion not available. Use the Step button and the arrow buttons.";
    else motion = "Motion not available, use the arrow keys.";
    return `${sound} ${motion}`;
  }

  /** Interrupted or suspended (iOS lock, app switch): say so and resume on the next gesture. */
  onAudioPaused(): void {
    const ctx = this.ctx;
    if (!ctx || this.resumeArmed) return;
    this.resumeArmed = true;
    this.onPause();
    this.speech.say("Sound paused. Press Space or tap to resume.", 3);
    const resume = () => {
      window.removeEventListener("keydown", resume, true);
      window.removeEventListener("pointerdown", resume, true);
      this.resumeArmed = false;
      Promise.resolve(ctx.resume()).then(() => this.onResume(), () => undefined);
    };
    window.addEventListener("keydown", resume, true);
    window.addEventListener("pointerdown", resume, true);
  }

  private build(ctx: AudioContext): void {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 12;
    limiter.attack.value = 0.003; limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    const pre = ctx.createGain();
    pre.channelCount = 2; pre.channelCountMode = "explicit"; pre.channelInterpretation = "speakers";
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
    pre.connect(split);
    this.matrix = [0, 1, 2, 3].map(() => ctx.createGain());
    // matrix[i]: from input channel (i >> 1) to output channel (i & 1)
    this.matrix.forEach((g, i) => { split.connect(g, i >> 1); g.connect(merge, 0, i & 1); });
    merge.connect(limiter);
    this.applyMatrix();
    const mk = (n: BusName) => { const g = ctx.createGain(); g.gain.value = BUS_LEVEL[n]; g.connect(pre); return g; };
    this.buses = { voice: mk("voice"), cue: mk("cue"), safety: mk("safety"), ambient: mk("ambient"), footsteps: mk("footsteps") };
    this.tapBus = this.buses.safety; this.beaconBus = this.buses.cue;
    this.echo = new Echo(ctx, pre);
    this.taps = renderTaps(ctx);
  }

  private applyMatrix(): void {
    if (this.matrix.length !== 4) return;
    const [ll, lr, rl, rr] = this.mono ? [0.5, 0.5, 0.5, 0.5] : this.swapped ? [0, 1, 1, 0] : [1, 0, 0, 1];
    [ll, lr, rl, rr].forEach((v, i) => { this.matrix[i].gain.value = v; });
  }

  setMono(on: boolean): void { this.mono = on; this.applyMatrix(); }
  setSwap(on: boolean): void { this.swapped = on; this.applyMatrix(); }

  /** Speech ducks the other buses; safety (cane taps, thud) never goes below -4 dB. */
  duck(on: boolean): void {
    const c = this.ctx, b = this.buses; if (!c || !b) return;
    (Object.keys(b) as BusName[]).forEach(k => b[k].gain.setTargetAtTime(BUS_LEVEL[k] * (on ? BUS_DUCK[k] : 1), c.currentTime, 0.02));
  }

  /**
   * The one way any buffer reaches the ears. With `at` it goes through spatialChain (HRTF) on its bus and into the
   * reverb send at -10 dB; without, it is in the head. At most two HRTF sounds at once: a lower priority one is
   * evicted, and a refused one falls back to in the head. Positioned sounds are announced on the bus for the ring.
   */
  playBuf(buf: AudioBuffer, o: PlayOpts): Playing | null {
    const c = this.ctx, b = this.buses; if (!c || !b) return null;
    const src = c.createBufferSource();
    src.buffer = buf;
    if (o.rate) src.playbackRate.value = o.rate;
    const g = c.createGain(); g.gain.value = Number.isFinite(o.gain ?? 1) ? (o.gain ?? 1) : 0;
    src.connect(g);
    let out: AudioNode = g, release: (() => void) | null = null, spatial = false, chain: ReturnType<typeof spatialChain> | null = null;
    const stop = () => { try { src.stop(); } catch { /* not started */ } };
    if (o.at) {
      release = this.budget.acquire(o.pri ?? 1, stop);
      if (release) {
        chain = spatialChain(c, o.at, this.pose, { panning: o.panning ?? this.panning });
        g.connect(chain.input); out = chain.output; spatial = true;
      } else if (o.spatialOnly) { g.disconnect(); return null; }
    }
    out.connect(b[o.bus]);
    const send = o.send ?? (spatial ? REVERB_SEND : 0);
    let sg: GainNode | null = null;
    if (send > 0 && this.echo) { sg = c.createGain(); sg.gain.value = send; out.connect(sg); sg.connect(this.echo.input); }
    src.onended = () => {
      release?.();
      try { src.disconnect(); g.disconnect(); chain?.output.disconnect(); chain?.panner.disconnect(); sg?.disconnect(); } catch { /* gone */ }
      o.onEnd?.();
    };
    if (o.at && o.announce !== false) this.bus.publish({ kind: "sound", at: o.at, label: o.label, sound: o.sound, bus: o.bus });
    src.start();
    return { stop, spatial };
  }

  panning: PanningModelType = "HRTF";

  /** Play a pre rendered tap now. pan -1..1, dist inside the cane for falloff, echo send amount. */
  play(kind: TapKind, opts: { pan?: number; dist?: number; gain?: number; send?: number; at?: Vec2; label?: string } = {}): void {
    const c = this.ctx; if (!c || !this.taps || !this.tapBus) return;
    if (opts.at) { // a contact point: HRTF from there (priority 3), falls back to the stereo pan below when the budget is full
      const p = this.playBuf(this.taps[kind], { bus: "safety", at: opts.at, pri: 3, spatialOnly: true, label: opts.label ?? "tap", sound: String(kind),
        gain: (opts.gain ?? 1) * Math.pow(10, ((Math.random() - 0.5) * 3) / 20), rate: 1 + (Math.random() - 0.5) * 0.06, send: opts.send === undefined ? undefined : opts.send * 0.5 });
      if (p) return;
    }
    const s = c.createBufferSource();
    s.buffer = this.taps[kind];
    s.playbackRate.value = 1 + (Math.random() - 0.5) * 0.06;          // ±3 percent pitch
    const g = c.createGain();
    const jitter = Math.pow(10, ((Math.random() - 0.5) * 3) / 20);   // ±1.5 dB
    const base = (opts.gain ?? 1) * (opts.dist !== undefined ? tapGain(opts.dist) : 1) * jitter;
    g.gain.value = Number.isFinite(base) ? base : 0;
    const p = c.createStereoPanner();
    const pan = opts.pan ?? 0;
    p.pan.value = Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : 0;
    s.connect(g).connect(p).connect(kind === "step" ? this.buses!.footsteps : this.tapBus);
    if (this.echo && (opts.send ?? 0.6) > 0) {
      const send = c.createGain(); send.gain.value = opts.send ?? 0.6;
      p.connect(send).connect(this.echo.input);
    }
    s.start();
  }

  listen(pos: Vec2, heading: number): void {
    if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1]) || !Number.isFinite(heading)) return;
    this.pose = { pos: [pos[0], pos[1]], heading };
    this.bus.listener = this.pose;
    if (this.ctx) placeListener(this.ctx.listener, pos, heading);
  }
}
