// Speech with priorities: one voice (am_michael clips through VoiceOut), the caption always written first (CLAUDE.md rule 7).
// No browser speech anywhere: a line without a clip is rendered by /api/tts, and if that fails VoiceOut plays a soft tone.
import { CueBus, captionText } from "../events";
import { lineId } from "../lines";
import type { Vec2 } from "../types";

export type Priority = 0 | 1 | 2 | 3; // 0 info, 1 landmark, 2 instruction, 3 safety
/** `at`: the line comes from that point (a name clip through the HRTF chain, a direction in the caption).
 *  `prefix`: a separate first word, "possibly" under 0.6 confidence. */
export type SayOpts = { at?: Vec2; prefix?: string };
type Deps = { raf?: (f: () => void) => void; doc?: Document };

export const RATE_MIN = 0.8, RATE_MAX = 1.6;
const HISTORY = 5;

export class Speech {
  rate = 1;
  last = "";
  lastPri: Priority = 2;
  lastOpts: SayOpts = {};
  /** The one event bus: every line is published here as a `say` cue (captions, audio, ring, observer). */
  bus = new CueBus();
  /** Set by VoiceOut: it plays the line as a clip, or a soft tone when it cannot. */
  hasClips = false;
  onCancel: () => void = () => {};
  private seq = 0;
  private waiters: (() => void)[] = [];
  onDuck: (on: boolean) => void = () => {};
  onSpeakingChange: (on: boolean) => void = () => {};
  /** Every line actually said or written (observer feed). */
  onSay: (text: string, pri: Priority) => void = () => {};
  private current: Priority | null = null;
  private raf: (f: () => void) => void;
  private doc: Document;

  constructor(deps: Deps = {}) {
    this.raf = deps.raf ?? ((f) => requestAnimationFrame(() => f()));
    this.doc = deps.doc ?? document;
  }

  setRate(r: number): void { this.rate = Math.max(RATE_MIN, Math.min(RATE_MAX, Math.round(r * 100) / 100)); }

  get speaking(): boolean { return this.current !== null; }
  /** Priority of the line being said now, or null. */
  get busyPri(): Priority | null { return this.current; }

  /** A line interrupts only lines of equal or lower priority; a lower one is dropped. */
  say(text: string, pri: Priority = 2, opts: SayOpts = {}): void { this.sayInner(text, pri, opts); }

  /** Like say, resolves when the line has finished, was cut off, or was dropped. */
  sayAsync(text: string, pri: Priority = 2, opts: SayOpts = {}): Promise<void> {
    const seq = this.sayInner(text, pri, opts);
    if (seq === 0 || this.current === null) return Promise.resolve();
    return new Promise(r => this.waiters.push(r));
  }

  private flush(): void { const w = this.waiters; this.waiters = []; w.forEach(f => f()); }

  private sayInner(text: string, pri: Priority, opts: SayOpts): number {
    if (this.current !== null && pri < this.current) return 0;
    const full = captionText(text, opts.prefix);
    this.last = text; this.lastPri = pri; this.lastOpts = opts;
    this.write(full, pri);
    try { this.onSay(full, pri); } catch { /* observer must never break speech */ }
    this.flush();                       // the line before this one is superseded
    const seq = ++this.seq;
    this.onCancel();
    this.bus.publish({ kind: "say", text, line: lineId(text), pri, at: opts.at, prefix: opts.prefix, seq });
    if (!this.hasClips) return seq;       // captions only: there is nothing to play it
    this.current = pri;
    return seq;
  }

  /** VoiceOut: the first clip of line `seq` started / the last one ended. */
  clipStarted(seq: number, pri: Priority): void { if (seq === this.seq) this.setCurrent(pri, true); }
  clipEnded(seq: number): void { if (seq === this.seq) this.setCurrent(null); }

  repeat(): void { if (this.last) this.say(this.last, Math.max(2, this.lastPri) as Priority, this.lastOpts); }

  stop(): void { this.onCancel(); this.setCurrent(null); this.flush(); }

  private setCurrent(p: Priority | null, started = false): void {
    if (p === null) { if (this.current !== null) { this.current = null; this.onDuck(false); this.onSpeakingChange(false); } this.flush(); return; }
    this.current = p;
    if (started) { this.onDuck(true); this.onSpeakingChange(true); }
  }

  private el(id: string): HTMLElement | null { return this.doc.getElementById(id); }

  /** Replace, never append; the same line twice is cleared then set on the next frame. */
  private write(text: string, _pri: Priority): void {
    const target = this.el("say-polite");
    const now = target;
    const hist = this.el("say-history");
    const prev = now?.textContent ?? "";
    if (hist && prev && prev !== text) {
      const li = this.doc.createElement("li"); li.textContent = prev;
      hist.prepend(li);
      while (hist.children.length > HISTORY) hist.lastElementChild!.remove();
    }
    if (!target) return;
    if (target.textContent === text) { target.textContent = ""; this.raf(() => { target.textContent = text; }); }
    else target.textContent = text;
  }
}
