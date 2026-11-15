// Spoken lines as audio: pre rendered Kokoro clips (web/public/buildings/<id>/voice/<line id>.wav), live lines from
// POST /api/tts. There is no other voice: when neither is ready within 600 ms (or the engine is down) the caption stays
// up and a soft tone plays (CLAUDE.md rule 7).
// A line with a position plays from there through the HRTF chain (audio.playBuf); a sentence is centred.
import type { Cue } from "../events";
import { lineId } from "../lines";
import type { Vec2 } from "../types";
import type { AudioEngine, Playing } from "./engine";
import type { Priority, Speech } from "./speech";

export const LIVE_BUDGET_MS = 600;
export const VOICE = "am_michael";
const DEAD_MS = 60_000;

export class ClipStore {
  ids = new Set<string>();
  private bufs = new Map<string, Promise<AudioBuffer | null>>();
  private deadUntil = 0;
  constructor(private ctx: BaseAudioContext, private base: string, private fetcher: typeof fetch = (...a) => fetch(...a),
    private now: () => number = () => Date.now()) {}

  async init(): Promise<void> {
    try {
      const r = await this.fetcher(`${this.base}/voice/index.json`);
      if (r.ok && !/text\/html/.test(r.headers?.get?.("content-type") ?? "")) this.ids = new Set(Object.keys(await r.json()));
    } catch { /* no clips for this building: live lines and the browser voice carry it */ }
  }

  has(id: string): boolean { return this.ids.has(id); }

  private decode(r: Response): Promise<AudioBuffer | null> {
    return r.arrayBuffer().then(b => this.ctx.decodeAudioData(b)).catch(() => null);
  }

  get(id: string): Promise<AudioBuffer | null> {
    let p = this.bufs.get(id);
    if (!p) {
      p = this.fetcher(`${this.base}/voice/${id}.wav`).then(r => (r.ok ? this.decode(r) : null)).catch(() => null);
      this.bufs.set(id, p);
    }
    return p;
  }

  /** A line with no clip: ask the engine to render it. A failure turns live lines off for a minute. */
  live(text: string): Promise<AudioBuffer | null> {
    const id = lineId(text);
    const have = this.bufs.get(id);
    if (have) return have;
    if (this.now() < this.deadUntil) return Promise.resolve(null);
    const p = this.fetcher("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: VOICE }) })
      .then(r => (r.ok ? this.decode(r) : null)).catch(() => null)
      .then(b => { if (!b) { this.bufs.delete(id); this.deadUntil = this.now() + DEAD_MS; } return b; });
    this.bufs.set(id, p);
    return p;
  }

  /** Fetch every known clip in the background, a few at a time, so the first name does not wait. */
  async preload(ids: string[] = [...this.ids], parallel = 3): Promise<void> {
    const q = [...ids];
    await Promise.all(Array.from({ length: parallel }, async () => { for (let id = q.shift(); id; id = q.shift()) await this.get(id); }));
  }
}

const sentences = (t: string): string[] => t.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*/g)?.map(s => s.trim()).filter(Boolean) ?? [];
const race = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  new Promise(res => { const t = setTimeout(() => res(null), ms); p.then(v => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(null); }); });

/** Ids of the lines this route will say first (instructions, names, intro prompts), so they are fetched before the rest. */
export function routeLineIds(texts: string[], store: Pick<ClipStore, "has">): string[] {
  const out: string[] = [];
  for (const t of texts) { const id = lineId(t); if (store.has(id)) out.push(id); else sentences(t).forEach(s => { const i = lineId(s); if (store.has(i)) out.push(i); }); }
  return [...new Set(out)];
}

export type Part = { text: string; id: string; at?: Vec2 };

/** The clips that make up one cue: the line (from `at`), as sentences if all have clips. */
export function partsFor(c: Cue, store: Pick<ClipStore, "has">): Part[] {
  const text = c.text ?? "";
  const out: Part[] = [];
  const whole = lineId(text);
  const ss = sentences(text);
  if (!store.has(whole) && ss.length > 1 && ss.every(s => store.has(lineId(s)))) ss.forEach(s => out.push({ text: s, id: lineId(s), at: c.at }));
  else if (text.length > 500) sentences(text).forEach(s => out.push({ text: s, id: lineId(s), at: c.at }));
  else out.push({ text, id: whole, at: c.at });
  return out;
}

export class VoiceOut {
  private active: Playing | null = null;
  private token = -1;
  private unsub: () => void;

  constructor(private audio: AudioEngine, private speech: Speech, readonly store: ClipStore) {
    speech.hasClips = true;
    speech.onCancel = () => this.cancel();
    this.unsub = speech.bus.subscribe(c => { if (c.kind === "say") void this.onSay(c); });
  }

  destroy(): void { this.unsub(); this.speech.hasClips = false; this.speech.onCancel = () => {}; this.cancel(); }

  private cancel(): void { this.token = -1; try { this.active?.stop(); } catch { /* ended */ } this.active = null; }

  private buffer(p: Part, ms: number): Promise<AudioBuffer | null> {
    return race(this.store.has(p.id) ? this.store.get(p.id) : this.store.live(p.text), ms);
  }

  private async onSay(c: Cue): Promise<void> {
    const seq = c.seq ?? 0, pri = (c.pri ?? 2) as Priority;
    this.token = seq;
    const parts = partsFor(c, this.store);
    const fallback = () => { if (this.token !== seq) return; this.audio.softTone(); this.speech.clipEnded(seq); };
    const play = async (i: number): Promise<void> => {
      if (this.token !== seq) return;
      if (i >= parts.length) { this.active = null; this.speech.clipEnded(seq); return; }
      const p = parts[i];
      const buf = await this.buffer(p, i === 0 ? LIVE_BUDGET_MS : 3000);
      if (this.token !== seq) return;
      if (!buf) { if (i === 0) fallback(); else void play(i + 1); return; }
      if (i === 0) this.speech.clipStarted(seq, pri);
      const h = this.audio.playBuf(buf, { bus: "voice", at: p.at, pri: 2, rate: this.speech.rate, announce: false, label: p.text, onEnd: () => { void play(i + 1); } });
      if (!h) { if (i === 0) fallback(); return; }
      this.active = h;
    };
    await play(0);
  }
}
