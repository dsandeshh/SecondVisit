// Captions subscribe to the one event bus. The text itself is written by Speech (it equals the spoken text); this adds
// the direction ("2 o'clock" and an arrow turned to the clock direction) and fits long lines into two rows.
import { CueBus, directionWords, polar, type Cue } from "../events";

const OCLOCK = /o'clock/i;
const LINES = 2;

export class Captions {
  private off: () => void;
  constructor(private doc: Document, private bus: CueBus) {
    this.off = bus.subscribe(c => this.onCue(c));
  }
  destroy(): void { this.off(); }

  private onCue(c: Cue): void {
    if (c.kind !== "say") return;
    this.direction(c);
    this.fit();
  }

  /** The caption gets its direction only when the line comes from a place and does not already say the clock. */
  direction(c: Cue): void {
    const el = this.doc.getElementById("say-dir");
    if (!el) return;
    el.replaceChildren();
    if (!c.at) { el.hidden = true; return; }
    const p = polar(this.bus.listener, c.at);
    el.hidden = false;
    if (!OCLOCK.test(c.text ?? "")) el.append(this.doc.createTextNode(directionWords(p) + " "));
    const arrow = this.doc.createElement("span");
    arrow.className = "dirarrow"; arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↑";
    arrow.style.transform = `rotate(${Math.round(p.az)}deg)`;
    el.dataset.az = String(Math.round(p.az));
    el.append(arrow);
  }

  /** Never cut a sentence: two rows at the normal size, one font step smaller if that is not enough, then it grows. */
  fit(): void {
    const el = this.doc.getElementById("say-polite");
    if (!el) return;
    el.classList.remove("is-long");
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 0;
    if (lh && el.scrollHeight > lh * LINES + 2) el.classList.add("is-long");
  }
}
