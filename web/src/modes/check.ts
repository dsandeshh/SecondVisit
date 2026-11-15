// "Check yourself" (C, or the button): three light questions about the route just walked, then the weak stretch.
// Every spoken line here is generated the same way by engine/dr/check_quiz.py, so each has a pre-rendered clip.
// Answerable from what was spoken: "passing the X" (instruction), "Turn left to 10 o'clock" (next instruction), "Walk N steps".
import type { BuildingPackage, QuizEntry, Route } from "../types";
import type { Priority } from "../audio/speech";
import type { Question } from "./quiz";
import { spokenOf } from "../names";

export const CHECK_START = "Check yourself. Three quick questions.";
export const TURN_OPTS = ["Turn left", "Turn right", "Keep straight", "You arrive"];
export const SCORE = ["None this time, and that is fine.", "One of three. A good start.", "Two of three. Nice.", "Three of three."];
export const ALL_RIGHT = "Three of three. You knew every turn. Walk the whole way again? Press Y or Enter.";
export const STRETCH_DONE = "That stretch is done. Press C to check yourself again, or X for Explore.";

type Pkg = Pick<BuildingPackage, "landmarks">;
const spoken = (pkg: Pkg, id: string) => { const l = pkg.landmarks.find(x => x.id === id); return l ? spokenOf(l) : ""; };

/** The landmark the instruction names after "passing the", if any (its id and spoken name). */
export function passed(pkg: Pkg, route: Route, i: number): string | null {
  const s = route.segments[i];
  for (const id of s.landmarks_passed) {
    const n = spoken(pkg, id);
    if (n && s.instruction.includes(`passing the ${n}`)) return n;
  }
  return null;
}

function stepOpts(s: number): string[] {
  const v = s <= 4 ? [s, s + 4, s + 8, s + 12] : [s - 4, s, s + 4, s + 8];
  return v.map(String);
}

/** Which segments the three questions are about: spread along the route. */
export const checkSegs = (n: number): number[] => [0, 1, 2].map(k => Math.floor((k * (n - 1)) / 2));

export function buildCheck(pkg: Pkg, route: Route): Question[] {
  const n = route.segments.length;
  const [a, b, c] = checkSegs(n);
  const out: Question[] = [];
  const name = passed(pkg, route, a);
  if (name) {
    const near = new Set(route.segments[a].landmarks_passed.map(id => spoken(pkg, id)));
    const others = [...new Set(pkg.landmarks.map(spokenOf))]
      .filter(x => x && x !== name && !route.segments[a].instruction.includes(x) && !near.has(x)).sort().slice(0, 3);
    const options = [name, ...others].sort();
    out.push({ kind: "wall", seg: a, q: `In stretch ${a + 1}, what do you walk past?`, options, answer: options.indexOf(name) });
  } else {
    const o = stepOpts(route.segments[a].steps);
    out.push({ kind: "steps", seg: a, q: `About how many steps is stretch ${a + 1}?`, options: o, answer: o.indexOf(String(route.segments[a].steps)) });
  }
  const t = b === n - 1 ? 3 : ({ left: 0, right: 1, none: 2 } as const)[route.segments[b].turn_after];
  out.push({ kind: "turn", seg: b, q: `At the end of stretch ${b + 1}, what comes next?`, options: TURN_OPTS, answer: t });
  const o = stepOpts(route.segments[c].steps);
  out.push({ kind: "steps", seg: c, q: `About how many steps is stretch ${c + 1}?`, options: o, answer: o.indexOf(String(route.segments[c].steps)) });
  return out;
}

export const questionLine = (k: number, q: Question): string =>
  `Question ${k + 1} of 3. ${q.q} ${q.options.map((o, i) => `${i + 1}, ${o}.`).join(" ")}`;
export const answerLine = (ok: boolean, opt: string): string => ok ? `Yes, ${opt}. Press Enter.` : `It was ${opt}. Press Enter.`;

/** One sentence naming the weak stretch, with the score first. */
export function weakLine(pkg: Pkg, route: Route, seg: number, correct: number): string {
  const name = passed(pkg, route, seg);
  const where = name ? `stretch ${seg + 1}, past the ${name.toLowerCase()}` : `stretch ${seg + 1}`;
  return `${SCORE[correct]} You were least sure about ${where}. Practise that stretch? Press Y or Enter.`;
}

/** Same interface as QuizSession, so the page draws the options the same way. */
export class CheckSession {
  i = 0;
  correct = 0;
  private answered = false;
  constructor(readonly questions: Question[], private say: (t: string, p?: Priority) => void,
    private record: (e: QuizEntry) => void) {}
  get current(): Question | null { return this.questions[this.i] ?? null; }
  get finished(): boolean { return this.i >= this.questions.length; }
  get isAnswered(): boolean { return this.answered; }
  optionsLine(): string { return this.current!.options.map((o, k) => `${k + 1}, ${o}.`).join(" "); }
  ask(): void { const q = this.current; if (!q) return; this.answered = false; this.say(questionLine(this.i, q), 2); }
  repeat(): void { if (this.current && !this.answered) this.ask(); }
  answer(n: number): boolean {
    const q = this.current;
    if (!q || this.answered || !Number.isInteger(n) || n < 1 || n > q.options.length) return false;
    this.answered = true;
    const ok = n - 1 === q.answer;
    if (ok) this.correct++;
    this.record({ q: q.q, seg: q.seg, correct: ok });
    this.say(answerLine(ok, q.options[q.answer]), 2);
    return ok;
  }
  next(): void { this.i++; }
}
