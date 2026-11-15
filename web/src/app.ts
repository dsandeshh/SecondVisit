// Visitor app wiring: Start gate, output mode choice, Explore on laptop and phone (Task 8).
import { AudioEngine, type StartReport } from "./audio/engine";
import { Speech, type Output } from "./audio/speech";
import { attachFocusGuard, attachKeys } from "./input/keyboard";
import { MotionInput } from "./input/orientation";
import { Explore } from "./modes/explore";
import type { BuildingPackage } from "./types";
import { World } from "./world";

export type App = { audio: AudioEngine; speech: Speech; pkg: BuildingPackage | null; explore: Explore | null };

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
  const app: App = { audio, speech, pkg: null, explore: null };
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

  $("start").addEventListener("click", () => {
    $("start-slot").hidden = true;
    $("modes").hidden = false;
    $("mode-app").focus();
  });

  const choose = (output: Output) => () => {
    if (audio.ctx || !app.pkg) return;
    const started = audio.start(output); // synchronous part runs inside this click
    void started.then(r => enter(app, doc, output, r, op));
  };
  $("mode-app").addEventListener("click", choose("app"));
  $("mode-sr").addEventListener("click", choose("screenreader"));
  return app;
}

function enter(app: App, doc: Document, output: Output, r: StartReport, op: boolean): void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T;
  const { audio, speech } = app;
  const pkg = app.pkg!;
  const phone = audio.mode !== "keys";
  const ex = new Explore(new World(pkg), audio, speech);
  app.explore = ex;

  $("home").hidden = true;
  $("rehearsal").hidden = false;
  $("topline").hidden = false;
  $("place").textContent = pkg.name;
  $("place-short").textContent = pkg.name;
  $("voice-label").textContent = output === "app" ? "Voice: app" : "Voice: screen reader";
  $("status").textContent = `Sound: ${r.audio}. Motion: ${r.motion}${audio.mode === "keys" ? ", using keys" : ""}.`;
  speech.onSpeakingChange = (on) => { $("speaking").hidden = !on; };
  if (op) {
    $("op-latency").textContent = `${r.latencyMs} ms${r.latencyMs > 50 ? " (over 50, check headphones are wired)" : ""}`;
    $("op-motion").textContent = `${r.motion}, mode ${audio.mode}`;
    $("op-output").textContent = output;
    $("op-voice").textContent = speech.voice?.name ?? "default";
  }

  const stage = $("stage");
  attachKeys(stage, ex);
  stage.addEventListener("mousemove", (e: MouseEvent) => {
    const b = stage.getBoundingClientRect();
    if (b.width > 0) ex.setCane(((e.clientX - b.left) / b.width * 2 - 1) * 50);
  });
  attachFocusGuard(window, { say: (t, p) => speech.say(t, p), timer: ex.timer, active: () => ex.active });
  audio.onPause = () => ex.timer.stop();
  audio.onResume = () => { ex.timer.start(); speech.say("Sound on.", 2); };

  if (phone) {
    doc.body.classList.add("is-phone");
    $("phone").hidden = false;
    $("turns").hidden = audio.mode === "motion";
    const step = $<HTMLButtonElement>("step");
    step.addEventListener("click", () => {
      step.classList.add("is-pressed");
      setTimeout(() => step.classList.remove("is-pressed"), 120);
      ex.step(1);
    });
    $("turn-left").addEventListener("click", () => ex.turn(-15));
    $("turn-right").addEventListener("click", () => ex.turn(15));
    $("repeat").addEventListener("click", () => ex.repeat());
    $("where").addEventListener("click", () => ex.where());
    if (audio.mode === "motion") {
      const m = new MotionInput(h => ex.face(h), d => ex.setCane(d));
      m.attach(ex.traveller.heading);
      $("recentre").addEventListener("click", () => { m.recentre(ex.traveller.heading); speech.say("Recentred.", 2); });
    } else {
      $("recentre").addEventListener("click", () => speech.say("Recentre needs motion. Use the turn buttons.", 2));
    }
    step.focus();
  } else {
    stage.focus();
  }

  ex.begin();
  // Status, ear check (Review Focus 9) and the Explore intro in one line, so nothing is dropped.
  speech.say(`${audio.statusLine(r)} Ear check: a tap left, then right. If that was backwards, press S. ${ex.intro(phone)}`, 2);
  audio.play(1, { pan: -1, send: 0 });
  setTimeout(() => audio.play(1, { pan: 1, send: 0 }), 500);
}
