// Quiz after the pointing task: 3 questions built from real route values (Task 10 web).
import type { QuizEntry, Route, Side } from "../types";
import type { Priority } from "../audio/speech";

export type Question = { kind: "steps" | "wall" | "turn"; q: string; options: string[]; answer: number; seg: number };

const WALL = ["On your left", "On your right", "No wall to follow"];
const TURN = ["Turn left", "Turn right", "No turn"];
const idx = (s: Side) => (s === "left" ? 0 : s === "right" ? 1 : 2);

/** Three questions: steps, wall side, turn. `seed` (the run number) rotates which stretches are asked about. */
export function buildQuiz(route: Route, seed = 0): Question[] {
  const n = route.segments.length;
  const at = (k: number) => (((seed + k) % n) + n) % n;
  const out: Question[] = [];

  const a = at(0);
  const real = [...new Set(route.segments.map(s => s.steps))].sort((x, y) => x - y);
  out.push({ kind: "steps", seg: a, q: `About how many steps is stretch ${a + 1} of ${n}?`,
    options: real.slice(0, 4).includes(route.segments[a].steps) ? real.slice(0, 4).map(String)
      : [...real.filter(v => v !== route.segments[a].steps).slice(0, 3), route.segments[a].steps].sort((x, y) => x - y).map(String),
    answer: 0 });
  out[0].answer = out[0].options.indexOf(String(route.segments[a].steps));

  const b = at(1);
  out.push({ kind: "wall", seg: b, q: `Which side is the wall on in stretch ${b + 1}?`, options: WALL, answer: idx(route.segments[b].wall_side) });

  const c = at(2);
  out.push({ kind: "turn", seg: c, q: `Which way do you turn after stretch ${c + 1}?`, options: TURN, answer: idx(route.segments[c].turn_after) });
  return out;
}

export class QuizSession {
  i = 0;
  correct = 0;
  private answered = false;

  constructor(readonly questions: Question[], private say: (t: string, p?: Priority) => void,
    private record: (e: QuizEntry) => void) {}

  get current(): Question | null { return this.questions[this.i] ?? null; }
  get finished(): boolean { return this.i >= this.questions.length; }
  get isAnswered(): boolean { return this.answered; }

  optionsLine(): string {
    const q = this.current!;
    return q.options.map((o, k) => `${k + 1}, ${o}.`).join(" ");
  }

  ask(): void {
    const q = this.current;
    if (!q) return;
    this.answered = false;
    this.say(`Question ${this.i + 1} of ${this.questions.length}. ${q.q} ${this.optionsLine()}`, 2);
  }

  repeat(): void { if (this.current && !this.answered) this.ask(); }

  /** n is 1 based. Returns whether it was right; keys out of range or after an answer do nothing. */
  answer(n: number): boolean {
    const q = this.current;
    if (!q || this.answered || !Number.isInteger(n) || n < 1 || n > q.options.length) return false;
    this.answered = true;
    const ok = n - 1 === q.answer;
    if (ok) this.correct++;
    this.record({ q: q.q, seg: q.seg, correct: ok });
    this.say(ok ? `Correct. ${q.options[q.answer]}. Press Enter for the next question.`
      : `Not this one. It was ${q.options[q.answer]}. Press Enter for the next question.`, 2);
    return ok;
  }

  next(): void { this.i++; }
}
