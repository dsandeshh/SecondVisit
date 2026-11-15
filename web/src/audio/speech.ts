// Speech with priorities, a local voice, sentence chunks, and the two output modes (CLAUDE.md rule 7).
export type Priority = 0 | 1 | 2 | 3; // 0 info, 1 landmark, 2 instruction, 3 safety
export type Output = "app" | "screenreader";

type Synth = Pick<SpeechSynthesis, "speak" | "cancel" | "resume" | "getVoices" | "paused" | "speaking"> &
  { addEventListener?: (k: string, f: () => void) => void };
type Deps = { synth?: Synth | null; Utterance?: typeof SpeechSynthesisUtterance; raf?: (f: () => void) => void;
  doc?: Document };

export const MAX_CHUNK = 160;
const HISTORY = 5;

/** Split at sentence ends into chunks of at most 160 characters (Chrome cuts long utterances). */
export function chunks(text: string, max = MAX_CHUNK): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const out: string[] = [];
  let cur = "";
  const push = (s: string) => { const t = s.trim(); if (t) out.push(t); };
  for (const raw of sentences) {
    const s = raw.trim();
    if (s.length > max) {
      push(cur); cur = "";
      let part = "";
      for (const w of s.split(" ")) {
        if ((part + " " + w).trim().length > max) { push(part); part = w; } else part = (part + " " + w).trim();
      }
      cur = part;
    } else if ((cur + " " + s).trim().length > max) { push(cur); cur = s; }
    else cur = (cur + " " + s).trim();
  }
  push(cur);
  return out;
}

export class Speech {
  output: Output = "app";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  /** Utterances kept alive until end or error (Chrome drops onend for collected utterances). */
  live: SpeechSynthesisUtterance[] = [];
  errors: string[] = [];
  last = "";
  lastPri: Priority = 2;
  onDuck: (on: boolean) => void = () => {};
  onSpeakingChange: (on: boolean) => void = () => {};
  /** Every line actually said or written (observer feed). */
  onSay: (text: string, pri: Priority) => void = () => {};
  private current: Priority | null = null;
  private synth: Synth | null;
  private U: typeof SpeechSynthesisUtterance | undefined;
  private raf: (f: () => void) => void;
  private doc: Document;

  constructor(deps: Deps = {}) {
    this.synth = deps.synth !== undefined ? deps.synth : (globalThis.speechSynthesis ?? null);
    this.U = deps.Utterance ?? (globalThis as any).SpeechSynthesisUtterance;
    this.raf = deps.raf ?? ((f) => requestAnimationFrame(() => f()));
    this.doc = deps.doc ?? document;
    const pick = () => this.pickVoice();
    if (this.synth?.addEventListener) this.synth.addEventListener("voiceschanged", pick);
    else if (this.synth) (this.synth as any).onvoiceschanged = pick;
    pick();
  }

  /** First local English voice; never trust "default". On Android leave voice unset, set only lang. */
  pickVoice(): void {
    const vs = this.synth?.getVoices() ?? [];
    if (/Android/i.test(globalThis.navigator?.userAgent ?? "")) { this.voice = null; return; }
    this.voice = vs.find(v => v.localService && v.lang?.toLowerCase().startsWith("en")) ?? this.voice;
  }

  setOutput(o: Output): void {
    this.output = o;
    const polite = this.el("say-polite"), assertive = this.el("say-assertive");
    polite?.setAttribute("aria-live", o === "screenreader" ? "polite" : "off");
    assertive?.setAttribute("aria-live", o === "screenreader" ? "assertive" : "off");
    if (o === "screenreader") this.synth?.cancel();
  }

  setRate(r: number): void { this.rate = Math.max(0.5, Math.min(2.5, Math.round(r * 100) / 100)); }

  /** First speak inside the Start gesture (iOS); app voice only. */
  prime(text: string): void {
    if (this.output !== "app" || !this.synth || !this.U) return;
    const u = new this.U(text);
    this.configure(u);
    this.track(u, 0);
    this.synth.speak(u);
  }

  get speaking(): boolean { return this.current !== null; }

  /** A line interrupts only lines of equal or lower priority; a lower one is dropped. */
  say(text: string, pri: Priority = 2): void {
    // A lost onend (Chrome) must not block lower lines forever.
    if (this.current !== null && this.synth && !this.synth.speaking && !(this.synth as any).pending) this.setCurrent(null);
    if (this.output === "app" && this.current !== null && pri < this.current) return;
    this.last = text; this.lastPri = pri;
    this.write(text, pri);
    try { this.onSay(text, pri); } catch { /* observer must never break speech */ }
    if (this.output !== "app" || !this.synth || !this.U) return;
    this.synth.cancel();
    this.live = [];
    if (this.synth.paused) this.synth.resume();
    const parts = chunks(text);
    this.current = pri;
    parts.forEach((p, i) => {
      const u = new this.U!(p);
      this.configure(u);
      this.track(u, pri, i === 0, i === parts.length - 1);
      this.synth!.speak(u);
    });
  }

  repeat(): void { if (this.last) this.say(this.last, Math.max(2, this.lastPri) as Priority); }

  stop(): void { this.synth?.cancel(); this.live = []; this.setCurrent(null); }

  private configure(u: SpeechSynthesisUtterance): void {
    u.rate = this.rate; u.lang = "en-US";
    if (this.voice) u.voice = this.voice;
  }

  private track(u: SpeechSynthesisUtterance, pri: Priority, first = true, lastChunk = true): void {
    this.live.push(u);
    const done = () => {
      this.live = this.live.filter(x => x !== u);
      if (lastChunk && this.current === pri && this.live.length === 0) this.setCurrent(null);
    };
    if (first) u.onstart = () => this.setCurrent(pri, true);
    u.onend = done;
    u.onerror = (e: any) => {
      const err = e?.error;
      if (err !== "canceled" && err !== "interrupted") this.errors.push(String(err));
      done();
    };
  }

  private setCurrent(p: Priority | null, started = false): void {
    if (p === null) { if (this.current !== null) { this.current = null; this.onDuck(false); this.onSpeakingChange(false); } return; }
    this.current = p;
    if (started) { this.onDuck(true); this.onSpeakingChange(true); }
  }

  private el(id: string): HTMLElement | null { return this.doc.getElementById(id); }

  /** Replace, never append; the same line twice is cleared then set on the next frame. */
  private write(text: string, pri: Priority): void {
    const target = this.output === "screenreader" && pri === 3 ? this.el("say-assertive") : this.el("say-polite");
    const now = this.el("say-polite");
    if (now && target !== now && this.output === "screenreader") now.textContent = "";
    const hist = this.el("say-history");
    const prev = now?.textContent ?? "";
    if (hist && prev && prev !== text) {
      const li = this.doc.createElement("li"); li.textContent = prev;
      hist.prepend(li);
      while (hist.children.length > HISTORY) hist.lastElementChild!.remove();
    }
    if (target !== now && hist) { // safety line in screen reader mode: keep it visible for a sighted helper
      const li = this.doc.createElement("li"); li.textContent = text; hist.prepend(li);
      while (hist.children.length > HISTORY) hist.lastElementChild!.remove();
    }
    if (!target) return;
    if (target.textContent === text) { target.textContent = ""; this.raf(() => { target.textContent = text; }); }
    else target.textContent = text;
  }
}
