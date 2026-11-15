// The guided intro, the one next action, and gentle recovery (CLAUDE.md rule 7; UI_DESIGN 4.2b item 9).
// Pure logic: the page and Session feed it keys and read text back.
import type { Phase } from "./session";

export type IntroStep = { text: string; keys: string[] };
export const INTRO: IntroStep[] = [
  { text: "Press Up to take a step.", keys: ["ArrowUp"] },
  { text: "Press Left or Right to turn.", keys: ["ArrowLeft", "ArrowRight"] },
  { text: "Press Q to hear what is around you.", keys: ["q"] },
];
export const INTRO_READY = "You're ready. Press Enter to start the rehearsal.";
export const INTRO_SKIPPED = "Intro skipped. Press Enter to start the rehearsal.";
export const INTRO_KEY = "sv.intro";
export const INTRO_GAP_MS = 700;

export type IntroIO = {
  say: (t: string) => void;
  show: (t: string | null) => void;
  later?: (f: () => void, ms: number) => unknown;
  cancelLater?: (h: unknown) => void;
  seen?: () => boolean;
  remember?: () => void;
};

export const storedSeen = (): boolean => { try { return localStorage.getItem(INTRO_KEY) === "1"; } catch { return false; } };
export const storeSeen = (): void => { try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* private mode */ } };

export class Intro {
  index = -1;           // -1 not started, 0..2 teaching, 3 ready
  active = false;
  private timer: unknown = null;
  constructor(private io: IntroIO) {}

  get prompt(): string | null {
    if (this.index < 0) return null;
    return this.index < INTRO.length ? INTRO[this.index].text : INTRO_READY;
  }

  /** Begin unless this viewer already finished it. Returns whether it started. */
  start(force = false): boolean {
    if (!force && (this.io.seen ?? storedSeen)()) return false;
    this.active = true; this.index = 0;
    this.io.show(this.prompt); this.io.say(this.prompt!);
    return true;
  }

  /** A key was pressed. Returns "skip" for Escape, "advance" when the awaited key came. */
  key(k: string): "skip" | "advance" | null {
    if (!this.active) return null;
    if (k === "Escape") { this.finish(); this.io.show(INTRO_SKIPPED); this.io.say(INTRO_SKIPPED); return "skip"; }
    if (!INTRO[this.index].keys.includes(k)) return null;
    this.index++;
    const text = this.prompt!;
    this.io.show(text);
    if (this.index >= INTRO.length) this.finish();
    const later = this.io.later ?? ((f, ms) => setTimeout(f, ms));
    if (this.timer && this.io.cancelLater) this.io.cancelLater(this.timer);
    this.timer = later(() => { this.timer = null; this.io.say(text); }, INTRO_GAP_MS);
    return "advance";
  }

  private finish(): void { this.active = false; (this.io.remember ?? storeSeen)(); }
}

export type NextCtx = { phase: Phase; offer?: boolean; intro?: string | null; picked?: boolean; pointed?: boolean; answered?: boolean; runNo?: number; hasRoute?: boolean };

/** The one clear next action, for the bottom strip. */
export function nextAction(c: NextCtx): string {
  switch (c.phase) {
    case "explore":
      if (c.intro) return `Next: ${c.intro.charAt(0).toLowerCase()}${c.intro.slice(1)}`;
      if (c.picked) return "Next: press Enter to walk to the place you chose";
      return c.hasRoute === false ? "Next: press Q to hear what is around you" : "Next: press Enter to skip the fly-in and start the walk to the door";
    case "rehearse": return "Next: follow the spoken directions. Press Space to hear them again";
    case "point": return c.pointed ? "Next: press Enter to go on" : "Next: turn with Left and Right, then press Space to confirm";
    case "quiz": if (c.offer) return "Next: press Y or Enter to practise, or X for Explore";
      return c.answered ? "Next: press Enter for the next question" : "Next: press 1 to 4 to answer";
    case "summary": return c.runNo === 2 ? "Next: press Space to hear the summary again" : "Next: press Enter to start run 2";
  }
}

export const BUMPS_FOR_HELP = 3, BUMP_WINDOW_MS = 10_000;
export const BUMP_HELP = "Try turning left or right, then step.";
export const LOST_MS = 20_000;
export const LOST_HELP = "Press Space to hear the instruction again, or W for where you are.";

export class BumpWatcher {
  private times: number[] = [];
  /** Record a bump; true when this is the 3rd within 10 s (and the count starts again). */
  note(nowMs: number): boolean {
    this.times = this.times.filter(t => nowMs - t <= BUMP_WINDOW_MS);
    this.times.push(nowMs);
    if (this.times.length < BUMPS_FOR_HELP) return false;
    this.times = [];
    return true;
  }
}

/** Plain words for a pointing error. */
export function closeness(errDeg: number): string {
  return errDeg <= 15 ? "That's close." : errDeg <= 45 ? "Not far off." : "Quite a way off.";
}
