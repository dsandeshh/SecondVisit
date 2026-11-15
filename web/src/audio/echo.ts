// Room reverb: procedural impulse, two convolvers crossfaded over 300 ms (agent3 1.7).
export const t60ForArea = (area: number): number => Math.min(2.0, 0.3 + 0.08 * Math.sqrt(Math.max(0, area)));

/** Decorrelated stereo noise, exp(-6.91 t / T60) envelope, 15 ms predelay, cutoff falling with time. */
export function impulse(ctx: BaseAudioContext, t60: number): AudioBuffer {
  const T = Math.max(0.1, Math.min(2.0, t60)), sr = ctx.sampleRate;
  const pre = Math.round(0.015 * sr), len = pre + Math.round(T * sr);
  const b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const cutoff = 8000 * Math.exp(-3 * t / T) + 300;          // highs die first
      const a = 1 - Math.exp(-2 * Math.PI * cutoff / sr);
      y += a * ((Math.random() * 2 - 1) - y);
      d[i] = y * Math.exp(-6.91 * t / T);
    }
  }
  return b;
}

export class Echo {
  readonly input: GainNode;
  private conv: [ConvolverNode, ConvolverNode];
  private wet: [GainNode, GainNode];
  private active = 0;
  private t60 = -1;
  private cache = new Map<number, AudioBuffer>();

  constructor(private ctx: AudioContext, out: AudioNode) {
    this.input = ctx.createGain();
    this.conv = [ctx.createConvolver(), ctx.createConvolver()];
    this.wet = [ctx.createGain(), ctx.createGain()];
    for (let i = 0; i < 2; i++) {
      this.wet[i].gain.value = 0;
      this.input.connect(this.conv[i]).connect(this.wet[i]).connect(out);
    }
  }

  /** Switch rooms: load the idle convolver and crossfade over 300 ms. Null area keeps the room. */
  setArea(area: number | null): void {
    if (area === null) return;
    const t60 = Math.round(t60ForArea(area) * 10) / 10;
    if (t60 === this.t60) return;
    this.t60 = t60;
    let buf = this.cache.get(t60);
    if (!buf) { buf = impulse(this.ctx, t60); this.cache.set(t60, buf); }
    const next = 1 - this.active, now = this.ctx.currentTime;
    this.conv[next].buffer = buf;
    const wetLevel = 0.15 + 0.25 * Math.min(1, (t60 - 0.3) / 1.4); // 0.15 small room to 0.4 lobby
    this.wet[next].gain.setValueAtTime(0, now);
    this.wet[next].gain.linearRampToValueAtTime(wetLevel, now + 0.3);
    this.wet[this.active].gain.setValueAtTime(this.wet[this.active].gain.value, now);
    this.wet[this.active].gain.linearRampToValueAtTime(0, now + 0.3);
    this.active = next;
  }
}
