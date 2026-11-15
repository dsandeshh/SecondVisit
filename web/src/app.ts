// Visitor app wiring: Start gate, output mode choice, Explore on laptop and phone (Task 8).
import { AudioEngine, type StartReport } from "./audio/engine";
import { Speech } from "./audio/speech";
import { attachFocusGuard, attachKeys } from "./input/keyboard";
import { MotionInput } from "./input/orientation";
import { obs } from "./observer/bus";
import { Explore, type ExploreHooks } from "./modes/explore";
import { Session, type Phase } from "./modes/session";
import type { QuizSession } from "./modes/quiz";
import { floorPlanAvailable, renderSummary } from "./modes/summary";
import type { BuildingPackage } from "./types";
import { Cockpit } from "./ui/cockpit";
import { World } from "./world";

export type App = { cockpit?: Cockpit | null; audio: AudioEngine; speech: Speech; pkg: BuildingPackage | null; explore: Explore | null; session: Session | null };

const FOCUSABLE = "a[href],button,input,select,textarea,[tabindex]";

/** Focusable elements that are not hidden, inert or disabled. */
export function focusables(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(e =>
    e.getAttribute("tabindex") !== "-1" && !(e as HTMLButtonElement).disabled && !e.closest("[hidden],[inert]"));
}

export async function loadPackage(id: string): Promise<BuildingPackage> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("bad building id");
  const r = await fetch(`/buildings/${id}/package.json`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as BuildingPackage;
}

export async function boot(doc: Document, params: URLSearchParams): Promise<App> {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T;
  const speech = new Speech({ doc });
  try { const r = Number(localStorage.getItem("sv.rate")); if (r) speech.setRate(r); } catch { /* none */ }
  const audio = new AudioEngine(speech);
  const app: App = { audio, speech, pkg: null, explore: null, session: null };
  const op = params.get("op") === "1";
  if (op) $("op").hidden = false;

  const id = params.get("b") ?? "fixture";
  try {
    app.pkg = await loadPackage(id);
    $("bname").textContent = app.pkg.name;
  } catch {
    $("bname").textContent = "not loaded";
    const err = $("load-error");
    err.hidden = false;
    err.textContent = "Error: this building could not be loaded. Check the link, or try the fixture building with ?b=fixture.";
  }

  // Always app voice (CLAUDE.md rule 7): Start is the gesture that creates the AudioContext and goes straight in.
  $("start").addEventListener("click", () => {
    if (audio.ctx || !app.pkg) return;
    const started = audio.start("app"); // synchronous part runs inside this click
    void started.then(r => enter(app, doc, r, op));
  });
  return app;
}

function enter(app: App, doc: Document, r: StartReport, op: boolean): void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T;
  const { audio, speech } = app;
  const pkg = app.pkg!;
  const phone = audio.mode !== "keys";
  const hooks: ExploreHooks = {};
  const ex = new Explore(new World(pkg), audio, speech, hooks);
  app.explore = ex;
  const session = new Session(ex, pkg, speech, hooks, {
    threadId: globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`,
    publish: m => obs.publish(m),
    audioRunning: () => audio.ctx?.state === "running",
    onPhase: p => showPhase(doc, session, p),
    onQuestion: q => showQuiz(doc, session, q),
  });
  app.session = session;

  if (!phone) app.cockpit = new Cockpit(doc, pkg, ex, session, hooks);
  $("home").hidden = true;
  $("rehearsal").hidden = false;
  $("topline").hidden = false;
  $("place").textContent = pkg.name;
  $("place-short").textContent = pkg.name;
  $("status").textContent = `Sound: ${r.audio}. Motion: ${r.motion}${audio.mode === "keys" ? ", using keys" : ""}.`;
  speech.onSpeakingChange = (on) => { $("speaking").hidden = !on; };
  if (op) {
    $("op-latency").textContent = `${r.latencyMs} ms${r.latencyMs > 50 ? " (over 50, check headphones are wired)" : ""}`;
    $("op-motion").textContent = `${r.motion}, mode ${audio.mode}`;
    $("op-output").textContent = "app voice";
    $("op-voice").textContent = speech.voice?.name ?? "default";
  }

  const stage = $("stage");
  attachKeys(stage, session);
  stage.addEventListener("mousemove", (e: MouseEvent) => {
    const b = stage.getBoundingClientRect();
    if (b.width > 0) ex.setCane(((e.clientX - b.left) / b.width * 2 - 1) * 50);
  });
  attachFocusGuard(window, { say: (t, p) => speech.say(t, p), timer: session.timer, active: () => ex.active });
  audio.onPause = () => session.timer.stop();
  audio.onResume = () => { session.timer.start(); speech.say("Sound on.", 2); };

  if (phone) {
    doc.body.classList.add("is-phone");
    $("phone").hidden = false;
    $("turns").hidden = audio.mode === "motion";
    const step = $<HTMLButtonElement>("step");
    step.addEventListener("click", () => {
      step.classList.add("is-pressed");
      setTimeout(() => step.classList.remove("is-pressed"), 120);
      session.stepButton();
    });
    $("turn-left").addEventListener("click", () => session.turn(-15));
    $("turn-right").addEventListener("click", () => session.turn(15));
    $("repeat").addEventListener("click", () => session.repeat());
    $("where").addEventListener("click", () => ex.where());
    if (audio.mode === "motion") {
      const m = new MotionInput(h => { if (session.phase !== "point") ex.face(h); }, d => ex.setCane(d));
      m.attach(ex.traveller.heading);
      $("recentre").addEventListener("click", () => { m.recentre(ex.traveller.heading); speech.say("Recentred.", 2); });
    } else {
      $("recentre").addEventListener("click", () => speech.say("Recentre needs motion. Use the turn buttons.", 2));
    }
    step.focus();
  } else {
    stage.focus();
  }

  $("go").addEventListener("click", () => session.enter());
  $("go").hidden = !session.hasRoute;
  showPhase(doc, session, "explore");
  ex.begin();
  // Status, ear check (Review Focus 9) and the Explore intro in one line, so nothing is dropped.
  speech.say(`${audio.statusLine(r)} Ear check: a tap left, then right. If that was backwards, press S. ${ex.intro(phone)}`, 2);
  audio.play(1, { pan: -1, send: 0 });
  setTimeout(() => audio.play(1, { pan: 1, send: 0 }), 500);
}

const STEP_NAMES: Record<Phase, number> = { explore: 0, rehearse: 1, point: 2, quiz: 2, summary: 3 };
const LEDE: Record<Phase, string> = {
  explore: "Explore by sound. Walk, turn and listen. Nothing is scored.",
  rehearse: "Rehearse the way in, one stretch at a time. Follow the spoken directions.",
  point: "Check yourself. Turn to face the destination, then confirm.",
  quiz: "Check yourself. Three questions about the route.",
  summary: "Pocket summary. Take it with you.",
};
const GO: Partial<Record<Phase, string>> = {
  explore: "Start rehearsal", point: "Continue", quiz: "Next question", summary: "Start run 2",
};

function showPhase(doc: Document, s: Session, p: Phase): void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T;
  doc.body.dataset.phase = p;
  doc.querySelectorAll("#steps-list li").forEach((li, i) => {
    const on = i === STEP_NAMES[p];
    const span = li.firstElementChild as HTMLElement;
    if (on) span.setAttribute("aria-current", "step"); else span.removeAttribute("aria-current");
    span.classList.toggle("steps__now", on);
  });
  $("lede").textContent = LEDE[p];
  const go = $<HTMLButtonElement>("go");
  const label = p === "summary" && s.runNo === 2 ? undefined : GO[p];
  go.hidden = !label || (p === "explore" && !s.hasRoute);
  if (label) go.textContent = label;
  const step = doc.getElementById("step");
  if (step) step.firstChild!.textContent = p === "point" ? "Confirm" : p === "quiz" || p === "summary" ? "Continue" : "Step";
  const hint = doc.querySelector(".step-button__hint");
  if (hint) hint.textContent = p === "point" ? "Tap to confirm where you point" : "Tap to take one step";
  $("summary").hidden = p !== "summary";
  if (p === "summary") {
    const draw = (fp: boolean) => renderSummary($("summary"), s.pkg, s.route!, { floorPlan: fp });
    draw(false);
    void floorPlanAvailable(s.pkg.id).then(draw);
    const c = s.coach;
    const line = $("coach-line");
    line.hidden = !c || s.runNo !== 1;
    if (c) line.textContent = `${c.line} (${c.source === "agent" ? "coach" : "scripted"})`;
  } else $("coach-line").hidden = true;
}

function showQuiz(doc: Document, s: Session, q: QuizSession | null): void {
  const host = doc.getElementById("quiz")!;
  host.replaceChildren();
  host.hidden = !q || q.finished;
  if (!q || q.finished) return;
  const cur = q.current!;
  const h = doc.createElement("h2");
  h.textContent = `Question ${q.i + 1} of ${q.questions.length}`;
  const p = doc.createElement("p");
  p.textContent = cur.q;
  host.append(h, p);
  cur.options.forEach((text, k) => {
    const b = doc.createElement("button");
    b.type = "button"; b.className = "btn btn--secondary quiz__opt";
    const num = doc.createElement("span"); num.className = "quiz__num"; num.setAttribute("aria-hidden", "true"); num.textContent = String(k + 1);
    b.append(num, doc.createTextNode(text));
    b.addEventListener("click", () => {
      const ok = q.answer(k + 1);
      if (q.isAnswered) {
        host.querySelectorAll("button").forEach((x, i) => {
          (x as HTMLButtonElement).setAttribute("aria-disabled", "true");
          if (i === cur.answer) x.append(doc.createTextNode(i === k ? " Correct" : " Correct answer"));
          else if (i === k && !ok) x.append(doc.createTextNode(" Not this one"));
        });
      }
    });
    host.append(b);
  });
  const rp = doc.createElement("p"); rp.className = "note"; rp.textContent = "Keys 1 to 4 answer. R repeats the options. Enter goes on.";
  host.append(rp);
}
