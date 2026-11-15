// Keyboard for the rehearsal stage, plus the focus guard (agent3 0.3, 0.4; Task 8 amendments).
import type { Priority } from "../audio/speech";

export interface KeyActions {
  step(dir: 1 | -1): void;
  turn(deg: number): void;
  /** -1 left, 1 right, 0 released */
  sweep(dir: -1 | 0 | 1): void;
  repeat(): void;
  heading(): void;
  where(): void;
  hint(): void;
  mono(): void;
  swap(): void;
  rate(delta: number): void;
  /** Enter: continue to the next phase. */
  enter?(): void;
  /** Keys 1 to 9 (quiz answers). */
  digit?(n: number): void;
  /** R: repeat the quiz options. */
  options?(): void;
  /** Q / Shift+Q: around me, with clock and steps after each name when `detail`. */
  around?(detail: boolean): void;
  /** E: ahead of me (the 60 degree cone and the free distance). */
  ahead?(): void;
  /** Tab / Shift+Tab: next or previous place. */
  pick?(dir: 1 | -1): void;
  /** An Up or Down press that came too soon after the last step: one cane tick, no step. */
  stepTick?(): void;
  /** B: the continuous beacon on or off (falls back to hint()). */
  beacon?(): void;
  /** Escape: clear the target, cut a sweep. */
  escape?(): void;
  /** S: where the current line comes from. Shift+S is swap(). */
  source?(): void;
  /** P: pause or resume everything. */
  pause?(): void;
  /** K: the keys, spoken and shown. */
  keys?(): void;
  /** X: back to Explore (from Rehearse, pointing, the quiz or the summary). */
  explore?(): void;
  /** C: Check yourself (three questions, then the weak stretch). */
  check?(): void;
  /** Y: yes to the offer after Check yourself (same as Enter there). */
  yes?(): void;
  /** Every handled key, first (cuts speech, resumes a paused AudioContext). `key` is the lower cased key. */
  any(key?: string): void;
}

export const STEP_GAP_MS = 400;
export const TURN_GAP_MS = 150;
export const TURN_DEG = 15;
const REPEATABLE = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function attachKeys(stage: HTMLElement, a: KeyActions, now: () => number = () => performance.now()): () => void {
  let lastStep = -Infinity, lastTurn = -Infinity;
  const down = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // The 3D view buttons live inside the stage: they keep Tab, Space and Enter (F6 reaches them); Escape goes back to the stage.
    if ((e.target as Element | null)?.closest?.(".room3d-bar")) { if (e.key === "Escape") { e.preventDefault(); stage.focus(); } return; }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k.startsWith("Arrow") || k === " " || k === "Tab") e.preventDefault(); // only while the stage has focus (the listener is on it)
    if (e.repeat && !REPEATABLE.has(k)) return;
    const t = now();
    const handled = () => a.any(k);
    switch (k) {
      case "ArrowUp": case "ArrowDown":
        handled();
        if (t - lastStep < STEP_GAP_MS) { if (!e.repeat) a.stepTick?.(); return; }   // a fresh press is never ignored
        lastStep = t; a.step(k === "ArrowUp" ? 1 : -1); return;
      case "ArrowLeft": case "ArrowRight":
        handled();
        if (e.repeat && t - lastTurn < TURN_GAP_MS) return;
        lastTurn = t; a.turn(k === "ArrowLeft" ? -TURN_DEG : TURN_DEG); return;
      case "a": handled(); a.sweep(-1); return;
      case "d": handled(); a.sweep(1); return;
      case " ": handled(); a.repeat(); return;
      case "Enter": handled(); a.enter?.(); return;
      case "r": handled(); a.options?.(); return;
      case "h": handled(); a.heading(); return;
      case "w": handled(); a.where(); return;
      case "b": handled(); (a.beacon ?? a.hint).call(a); return;
      case "m": handled(); a.mono(); return;
      case "s": handled(); if (e.shiftKey) a.swap(); else (a.source ?? a.swap).call(a); return;
      case "q": handled(); a.around?.(e.shiftKey); return;
      case "e": handled(); a.ahead?.(); return;
      case "Tab": handled(); a.pick?.(e.shiftKey ? -1 : 1); return;
      case "Escape": handled(); a.escape?.(); return;
      case "k": handled(); a.keys?.(); return;
      case "x": handled(); a.explore?.(); return;
      case "p": handled(); a.pause?.(); return;
      case "c": handled(); a.check?.(); return;
      case "y": handled(); a.yes?.(); return;
      case "1": case "2": case "3": case "4": case "5": case "6": case "7": case "8": case "9":
        handled(); a.digit?.(Number(k)); return;
      case "+": case "=": handled(); a.rate(0.15); return;
      case "-": case "_": handled(); a.rate(-0.15); return;
    }
  };
  const up = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === "a" || k === "d") a.sweep(0);
  };
  stage.addEventListener("keydown", down);
  stage.addEventListener("keyup", up);
  return () => { stage.removeEventListener("keydown", down); stage.removeEventListener("keyup", up); };
}

type Guard = { say: (t: string, p: Priority) => void; timer: { stop(): void; start(): void }; active: () => boolean };

/** Window blur pauses the run and says so; focus resumes it. */
export function attachFocusGuard(win: Window, g: Guard): () => void {
  let paused = false;
  const blur = () => { if (!g.active() || paused) return; paused = true; g.timer.stop(); g.say("Paused. Focus lost.", 3); };
  const focus = () => { if (!paused) return; paused = false; g.say("Resumed.", 2); g.timer.start(); };
  win.addEventListener("blur", blur);
  win.addEventListener("focus", focus);
  return () => { win.removeEventListener("blur", blur); win.removeEventListener("focus", focus); };
}
