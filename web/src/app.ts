// Visitor app wiring: Start gate, output mode choice, Explore on laptop and phone (Task 8).
import { AudioEngine, type StartReport } from "./audio/engine";
import { Speech } from "./audio/speech";
import { ClipStore, routeLineIds, VoiceOut } from "./audio/voice";
import { INTRO, INTRO_READY, INTRO_SKIPPED, storeSeen, storedSeen } from "./modes/guide";
import { spokenOf } from "./names";
import { Captions } from "./ui/captions";
import { attachFocusGuard, attachKeys } from "./input/keyboard";
import { MotionInput } from "./input/orientation";
import { obs } from "./observer/bus";
import type { ObsMsg } from "./observer/protocol";
import { targetOrder } from "./modes/beacon";
import { Explore, type ExploreHooks } from "./modes/explore";
import { Session, type Phase } from "./modes/session";
import type { QuizSession } from "./modes/quiz";
import { floorPlanAvailable, renderSummary } from "./modes/summary";
import type { BuildingPackage } from "./types";
import { Cockpit } from "./ui/cockpit";
import { World } from "./world";
import { fullFlow, loadOutdoorHook, runFlow } from "./flow";

export type App = { voice?: VoiceOut; captions?: Captions; cockpit?: Cockpit | null; audio: AudioEngine; speech: Speech; pkg: BuildingPackage | null; explore: Explore | null; session: Session | null };

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
    // Clips for this route and room are fetched inside the same gesture, before anything else.
    const store = new ClipStore(audio.ctx!, `/buildings/${app.pkg.id}`);
    const pkg = app.pkg;
    const first = [...INTRO.map(s => s.text), INTRO_READY, INTRO_SKIPPED, ...pkg.routes.flatMap(r => r.segments.map(s => s.instruction)),
      ...pkg.landmarks.map(l => spokenOf(l))];
    void store.init().then(() => store.preload([...routeLineIds(first, store), ...store.ids])).catch(() => undefined);
    void started.then(r => enter(app, doc, r, op, store, fullFlow(params)));
  });
  return app;
}

function enter(app: App, doc: Document, r: StartReport, op: boolean, store: ClipStore, full = false): void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T;
  const { audio, speech } = app;
  const pkg = app.pkg!;
  const phone = audio.mode !== "keys";
  const hooks: ExploreHooks = {};
  // One event bus: voice clips, captions and the observer all subscribe to speech.bus (the 3D ring does in the cockpit).
  app.voice = new VoiceOut(audio, speech, store);
  app.captions = new Captions(doc, speech.bus);
  speech.bus.subscribe(c => obs.publish(c as ObsMsg));
  const ex = new Explore(new World(pkg), audio, speech, hooks);
  app.explore = ex;
  const session = new Session(ex, pkg, speech, hooks, {
    threadId: globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`,
    publish: m => obs.publish(m),
    audioRunning: () => audio.ctx?.state === "running",
    onPhase: p => showPhase(doc, session, p),
    onQuestion: q => showQuiz(doc, session, q),
    onNext: t => { $("next-action").textContent = t; },
    onIntro: t => showIntro(doc, t),
    onHold: on => { audio.hold(on); try { on ? globalThis.speechSynthesis?.pause() : globalThis.speechSynthesis?.resume(); } catch { /* none */ } },
    onLeave: () => { const tab = doc.querySelector<HTMLElement>("#steps-list li:not([data-arrive]) span"); tab?.focus(); },
    chime: () => { audio.cue("chime", { bus: "cue", gain: 1, announce: true, label: "chime" }); },
    introSeen: () => new URLSearchParams(doc.location?.search).get("intro") === "1" ? false : storedSeen(),
    introRemember: storeSeen,
    onKeys: () => { const k = doc.getElementById("keys-panel") as HTMLDetailsElement | null; if (!k) return; k.open = true; k.classList.add("is-flash"); setTimeout(() => k.classList.remove("is-flash"), 1500); },
  });
  app.session = session;

  if (!phone) app.cockpit = new Cockpit(doc, pkg, ex, session, hooks);
  if (full) addArriveTab(doc);
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
  const attach = () => attachKeys(stage, session);   // in the full flow the interior keys start when the walker is inside
  if (!full) attach();
  wireRegions(doc, stage, speech, session);
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
    $("where").addEventListener("click", () => session.where());
    $("around").addEventListener("click", () => session.around(false));
    $("ahead").addEventListener("click", () => session.ahead());
    const places = $<HTMLButtonElement>("places"), list = $("places-list");
    const setPlaces = (running: boolean) => { places.textContent = running ? "Stop" : "Places"; places.setAttribute("aria-expanded", "false"); list.hidden = true; };
    places.addEventListener("click", () => {
      if (places.textContent === "Stop") { session.escape(); setPlaces(false); return; }
      list.hidden = !list.hidden; places.setAttribute("aria-expanded", String(!list.hidden));
      if (list.hidden) return;
      list.replaceChildren();
      targetOrder(ex.fx.items, ex.traveller.pos, ex.destination?.id).slice(0, 12).forEach(it => {
        const b = doc.createElement("button"); b.type = "button"; b.className = "btn btn--secondary"; b.textContent = it.name;
        b.addEventListener("click", () => { list.hidden = true; ex.fx.go(it.id); });
        list.append(b);
      });
    });
    speech.bus.subscribe(c => { if (c.kind === "pick" && c.ids?.includes("go")) setPlaces(true); else if (c.kind === "arrive") setPlaces(false); });
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
  const beginInterior = () => {
    if (full) { attach(); doc.body.dataset.flow = "inside"; $("room3d").hidden = false; stage.focus(); }
    showPhase(doc, session, "explore");
    ex.begin();
    // Status, ear check (Review Focus 9) and the Explore intro in one line, so nothing is dropped.
    if (r.audio === "running" && session.startIntro()) { /* the guided intro speaks first: one key at a time */ }
    else speech.say(`${audio.statusLine(r)} Ear check: a tap left, then right. If that was backwards, press Shift and S. ${ex.intro(phone)}`, 2);
    audio.play(1, { pan: -1, send: 0 });
    setTimeout(() => audio.play(1, { pan: 1, send: 0 }), 500);
  };
  if (!full) { beginInterior(); return; }
  // ?flow=full: Home, fly in, curb walk (outdoor hook), then the interior at pkg.entrances[0] (see flow.ts for the contract).
  void loadOutdoorHook().then(hook => runFlow({
    hook, pkg, stage, say: (t, p) => speech.say(t, p ?? 2), bus: speech.bus, begin: beginInterior,
    onOutdoor: on => { doc.body.dataset.flow = on ? "arrive" : "inside"; $("room3d").hidden = on; setArriveTab(doc, on); },
  }));
}

/** "Arrive" before Explore in the mode tabs (full flow only). */
function addArriveTab(doc: Document): void {
  const list = doc.getElementById("steps-list");
  if (!list || list.querySelector("[data-arrive]")) return;
  const li = doc.createElement("li"), span = doc.createElement("span");
  li.dataset.arrive = "1"; span.textContent = "Arrive";
  li.append(span); list.prepend(li);
  doc.body.dataset.flow = "arrive";
}
function setArriveTab(doc: Document, on: boolean): void {
  const span = doc.querySelector<HTMLElement>("#steps-list li[data-arrive] span");
  if (!span) return;
  if (on) { span.setAttribute("aria-current", "step"); span.classList.add("steps__now"); }
  else { span.removeAttribute("aria-current"); span.classList.remove("steps__now"); }
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
  const off = doc.querySelector("#steps-list li[data-arrive]") ? 1 : 0;
  doc.querySelectorAll("#steps-list li").forEach((li, i) => {
    if ((li as HTMLElement).dataset.arrive) return;
    const on = i - off === STEP_NAMES[p];
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

/** The large intro prompt over the 3D view (and on the phone, the next action strip carries it). */
function showIntro(doc: Document, text: string | null): void {
  const el = doc.getElementById("intro-prompt");
  if (!el) return;
  el.textContent = text ?? "";
  el.hidden = !text;
}

/** The way out of the stage (WCAG 2.1.2): Escape with nothing running, or F6 / Shift+F6 to cycle regions. */
export function wireRegions(doc: Document, stage: HTMLElement, speech: Speech, session: Session): void {
  const tab = doc.querySelector<HTMLElement>("#steps-list li:not([data-arrive]) span");
  if (tab) {
    tab.tabIndex = 0; tab.setAttribute("role", "button");
    tab.setAttribute("aria-label", "Explore. Press Enter to go back to the rehearsal.");
    const back = () => { stage.focus(); speech.say("Back in the rehearsal.", 2); };
    tab.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); back(); } });
    tab.addEventListener("click", back);
  }
  const regions: [string, () => HTMLElement | null][] = [
    ["Top bar.", () => tab ?? null], ["Rehearsal.", () => stage],
    ["", () => doc.querySelector<HTMLElement>(".objects__scroll")],                           // objects list and the add form
    ["Keys.", () => doc.querySelector<HTMLElement>("#keys-panel > summary")],
    ["Agent and data.", () => doc.querySelector<HTMLElement>("#data-panel > summary")],
  ];
  doc.addEventListener("keydown", e => {
    if (e.key !== "F6") return;
    e.preventDefault();
    const at = regions.findIndex(([, f]) => { const el = f(); return !!el && (el === doc.activeElement || el.contains(doc.activeElement)); });
    const n = regions.length, i = ((at < 0 ? 0 : at + (e.shiftKey ? -1 : 1)) + n) % n;
    const [name, f] = regions[i];
    f()?.focus();
    speech.stop();
    if (name) speech.say(name, 2);
  });
  void session;
}
