// Audio engine: the Start sequence (iOS, Android, desktop) and the master chain (agent3 1.1, 1.9).
// sources -> ducking gains -> channel swap (S) / mono (M) -> limiter -> destination.
import type { Vec2 } from "../types";
import { firstRealOrientation, modeFor, requestMotion, type InputMode, type Motion } from "../input/orientation";
import { Echo } from "./echo";
import { tapGain } from "./cane";
import { placeListener } from "./space";
import type { Output, Speech } from "./speech";
import { renderTaps, type TapKind } from "./taps";

export type StartReport = { audio: "running" | "failed"; motion: Motion; vibrate: boolean; latencyMs: number };

const latencyOf = (c: AudioContext) =>
  Math.round(1000 * ((c.baseLatency ?? 0) + ((c as any).outputLatency ?? 0)));

const DUCK_TAPS = 0.63;     // -4 dB: taps are the safety channel, never ducked further
const DUCK_BEACONS = 0.316; // -10 dB

export class AudioEngine {
  ctx: AudioContext | null = null;
  mode: InputMode = "keys";
  report: StartReport | null = null;
  mono = false;
  swapped = false;
  taps: Record<TapKind, AudioBuffer> | null = null;
  echo: Echo | null = null;
  tapBus: GainNode | null = null;
  beaconBus: GainNode | null = null;
  onPause: () => void = () => {};
  onResume: () => void = () => {};
  private matrix: GainNode[] = []; // LL, LR, RL, RR
  private resumeArmed = false;

  constructor(readonly speech: Speech) {
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
    limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.1;
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
    this.tapBus = ctx.createGain(); this.tapBus.connect(pre);
    this.beaconBus = ctx.createGain(); this.beaconBus.connect(pre);
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

  duck(on: boolean): void {
    const c = this.ctx; if (!c || !this.tapBus || !this.beaconBus) return;
    this.tapBus.gain.setTargetAtTime(on ? DUCK_TAPS : 1, c.currentTime, 0.03);
    this.beaconBus.gain.setTargetAtTime(on ? DUCK_BEACONS : 1, c.currentTime, 0.03);
  }

  /** Play a pre rendered tap now. pan -1..1, dist inside the cane for falloff, echo send amount. */
  play(kind: TapKind, opts: { pan?: number; dist?: number; gain?: number; send?: number } = {}): void {
    const c = this.ctx; if (!c || !this.taps || !this.tapBus) return;
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
    s.connect(g).connect(p).connect(this.tapBus);
    if (this.echo && (opts.send ?? 0.6) > 0) {
      const send = c.createGain(); send.gain.value = opts.send ?? 0.6;
      p.connect(send).connect(this.echo.input);
    }
    s.start();
  }

  listen(pos: Vec2, heading: number): void {
    if (this.ctx && Number.isFinite(pos[0]) && Number.isFinite(pos[1]) && Number.isFinite(heading))
      placeListener(this.ctx.listener, pos, heading);
  }
}
