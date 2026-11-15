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
import { mountRing } from "./ui/ring";
import { createRouter, pageFromHash, type Page, type Router } from "./pages/router";
import { PAGE_LINES } from "./pages/lines";
import { FALLBACK_LINE } from "./showcase/load";
import { loadShowcase, type ShowcaseHandle } from "./pages/showcase_hook";
import { renderScore, type RunResult } from "./pages/score";
import { cardWanted, mountKeyCard } from "./pages/keycard";
import { mountKeyPill } from "./pages/keypill";
import { OFFLINE, resolveAddress, tierLines, type Resolved } from "./home/home";
import { lineId } from "./lines";
import { World } from "./world";
import { loadOutdoorHook, runFlow } from "./flow";

/** v2: the journey starts outside by default; ?flow=interior opens inside. */
const fullFlow = (params: URLSearchParams): boolean => params.get("flow") !== "interior";

/** V: Michael says which view is now on screen (both in FIXED_UI_LINES). */
export const PHOTO_ON_LINE = "Photo view, the listing's own photos.";
export const PHOTO_OFF_LINE = "Scan view.";

/** Said and shown when something inside the rehearsal fails: the visitor stays on #/inside and keeps the keys. */
export const OOPS_LINE = "Something went wrong. Press Escape or F6 to move on.";

/** Run one risky step of the rehearsal setup; a failure is logged and handed to `onFail`, never thrown up to the router. */
export function safely(label: string, f: () => void, onFail?: (e: unknown) => void): boolean {
  try { f(); return true; } catch (e) { console.error(`SecondVisit: ${label} failed`, e); try { onFail?.(e); } catch { /* the fallback must not throw */ } return false; }
}

/** The documented safe state inside: #/inside, first person on the mesh, the calm note, and the line said once. */
export function safeInside(app: App, doc: Document, line = OOPS_LINE): void {
  const stage = doc.getElementById("stage");
  if (stage) { stage.dataset.view = "mesh"; }
  const n = doc.getElementById("photo-note");
  if (n) { n.textContent = line; n.hidden = false; }
  if (app.router && app.router.page !== "inside") app.router.go("inside", true);
  try { app.speech.say(line, 2); } catch { /* */ }
  (stage as HTMLElement | null)?.focus?.();
}

export type App = { router?: Router; voice?: VoiceOut; captions?: Captions; cockpit?: Cockpit | null; audio: AudioEngine; speech: Speech; pkg: BuildingPackage | null; explore: Explore | null; session: Session | null };

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

  // Hash routes: one page at a time. Before Start only Home (and the static About page) can show: the Start press is the
  // gesture that creates the AudioContext, so a reload on #/inside shows Home first. That reload is remembered, and
  // Start then goes straight back to #/inside (no fly in again).
  const resumeInside = ["inside", "check", "summary"].includes(pageFromHash(window.location.hash) ?? "");
  let started = false;
  lockScroll(doc);
  const router = createRouter(window, doc, p => (!started && p !== "home" && p !== "about" ? "home" : p), (p, prev) => onPage(app, doc, p, prev, started));
  app.router = router;

  let id = params.get("b") ?? "x37LjPx62VA";
  const setName = (name: string) => { $("bname").textContent = name; };
  const markBuildings = () => doc.querySelectorAll<HTMLButtonElement>("#buildings button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sid === id)));
  const loadId = async (sid: string): Promise<boolean> => {
    try {
      const pkg = await loadPackage(sid);
      app.pkg = pkg; id = sid; setName(pkg.name); $("load-error").hidden = true; markBuildings();
      return true;
    } catch {
      setName("not loaded");
      const err = $("load-error");
      err.hidden = false;
      err.textContent = "Error: this building could not be loaded. Check the link, or try the demo lobby with ?b=fixture.";
      return false;
    }
  };
  const host = $("buildings");
  for (const o of OFFLINE) {
    const b = doc.createElement("button");
    b.type = "button"; b.className = "building"; b.dataset.sid = o.sid; b.setAttribute("aria-pressed", "false");
    const n = doc.createElement("strong"); n.textContent = o.name;
    const a = doc.createElement("span"); a.textContent = o.address;
    b.append(n, a);
    b.addEventListener("click", () => { $<HTMLInputElement>("addr").value = o.name; begin(o.sid); });   // a card selects that building and starts, same path as Start
    host.append(b);
  }
  if (!(await loadId(id)) && id !== "fixture") await loadId("fixture");

  // The address box is honest (three tiers): a built building opens; a Houston or LA model without a package, or
  // anything else, is said and shown here with the building buttons to pick from. Never a silent jump into another building.
  const tierNote = $("home-tier");
  const sayTier = async (hit: Resolved | null): Promise<void> => {
    const lines = tierLines(hit);
    tierNote.textContent = (hit ? `${hit.name}${hit.address ? `, ${hit.address}` : ""}. ` : "") + lines.join(" ");
    tierNote.hidden = false;
    doc.querySelector<HTMLButtonElement>("#buildings button")?.focus();
    if (!app.voice && audio.ctx) {   // Michael's clips for UI lines live in every built building's voice folder: the
      let store: ClipStore | null = null;   // loaded one first, else any built building that has these lines rendered
      for (const sid of [...new Set([id, ...OFFLINE.map(o => o.sid)])]) {
        const s = new ClipStore(audio.ctx, `/buildings/${sid}`);
        await s.init();
        store ??= s;
        if (lines.every(l => s.has(lineId(l)))) { store = s; break; }
      }
      app.voice = new VoiceOut(audio, speech, store!);
    }
    speech.say(lines.join(" "), 2);   // one cue: VoiceOut plays it as two clipped sentences
  };

  // Always app voice (CLAUDE.md rule 7): Start is the gesture that creates the AudioContext and goes straight in.
  let entering = false;
  let audioStarted: Promise<StartReport> | null = null;
  const begin = (pick?: string): void => {
    if (entering || (!app.pkg && !pick)) return;
    entering = true;
    const started0 = audioStarted ??= audio.start(); // synchronous part runs inside this click; a later press reuses it
    const typed = pick ? "" : $<HTMLInputElement>("addr").value.trim();
    tierNote.hidden = true;
    void (async () => {
      try {
      if (pick && pick !== id && !(await loadId(pick))) { entering = false; return; }
      if (typed) {   // an address that names another building loads it first (the list below the box, or the engine resolver)
        const hit = await resolveAddress(typed);
        if (!hit || hit.tier === "outdoor") { await started0; entering = false; await sayTier(hit); return; }
        if (hit.sid !== id && !(await loadId(hit.sid))) { entering = false; return; }
      }
      const r = await started0;
      const pkg = app.pkg!;
      // Clips for this route and room are fetched as soon as the gesture's audio exists.
      const store = new ClipStore(audio.ctx!, `/buildings/${pkg.id}`);
      const first = [...INTRO.map(s => s.text), INTRO_READY, INTRO_SKIPPED, ...Object.values(PAGE_LINES) as string[], ...pkg.routes.flatMap(r2 => r2.segments.map(s => s.instruction)),
        ...pkg.landmarks.map(l => spokenOf(l))];
      void store.init().then(() => store.preload([...routeLineIds(first, store), ...store.ids])).catch(() => undefined);
      started = true;
      enter(app, doc, r, op, store, fullFlow(params) && !resumeInside, cardWanted(params));
     } catch (e) {
      // Never a silent kick back to Home mid rehearsal: once started, the safe state is #/inside.
      console.error("SecondVisit: starting the rehearsal failed", e);
      if (started) safeInside(app, doc);
      else { entering = false; const err = $("load-error"); err.hidden = false; err.textContent = "Error: the rehearsal could not start. Reload the page and press Start again."; }
     }
    })();
  };
  $<HTMLFormElement>("home-form").addEventListener("submit", e => { e.preventDefault(); begin(); });
  return app;
}

function enter(app: App, doc: Document, r: StartReport, op: boolean, store: ClipStore, full = false, card = false): void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T;
  const { audio, speech } = app;
  const pkg = app.pkg!;
  const phone = audio.mode !== "keys";
  const hooks: ExploreHooks = {};
  // One event bus: voice clips, captions and the observer all subscribe to speech.bus (the 3D ring does in the cockpit).
  app.voice?.destroy();   // the home tier voice (if any) hands over to this building's clips
  app.voice = new VoiceOut(audio, speech, store);
  app.captions = new Captions(doc, speech.bus);
  speech.bus.subscribe(c => obs.publish(c as ObsMsg));
  const ex = new Explore(new World(pkg), audio, speech, hooks);
  app.explore = ex;
  const session = new Session(ex, pkg, speech, hooks, {
    threadId: globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`,
    publish: m => obs.publish(m),
    audioRunning: () => audio.ctx?.state === "running",
    onPhase: p => showPhase(doc, session, p, app.router),
    onQuestion: q => showQuiz(doc, session, q),
    onNext: t => { $("next-action").textContent = doc.body.dataset.flow === "inside" ? t.replace("skip the fly-in and start the walk to the door", "start the rehearsal") : t; },
    onIntro: t => showIntro(doc, t),
    onHold: on => { audio.hold(on); },
    onLeave: () => { (app.router?.page === "summary" ? $("again") : $("pause")).focus(); },
    chime: () => { audio.cue("chime", { bus: "cue", gain: 1, announce: true, label: "chime" }); },
    introSeen: () => new URLSearchParams(doc.location?.search).get("intro") === "1" ? false : storedSeen(),
    introRemember: storeSeen,
    onKeys: () => { const k = doc.getElementById("keys-panel") as HTMLDetailsElement | null; if (!k) return; k.open = true; app.router?.go("about"); k.classList.add("is-flash"); setTimeout(() => k.classList.remove("is-flash"), 1500); },
  });
  app.session = session;

  if (!phone) safely("the 3D view", () => { app.cockpit = new Cockpit(doc, pkg, ex, session, hooks, undefined, { view: "eye" }); });   // first person on the mesh, never behind
  $("place").textContent = pkg.name;
  $("place-short").textContent = pkg.name;
  $("status").textContent = `Sound: ${r.audio}. Motion: ${r.motion}${audio.mode === "keys" ? ", using keys" : ""}.`;
  speech.onSpeakingChange = (on) => { $("speaking").hidden = !on; };
  const ringOff = mountRing($<HTMLCanvasElement>("ring"), speech.bus);
  void ringOff;
  const pauseBtn = $<HTMLButtonElement>("pause");
  pauseBtn.addEventListener("click", () => { session.pause(); stage.focus(); });
  $("help").addEventListener("click", () => session.keys());
  setInterval(() => { const t = audio.ctx?.state === "suspended" || session.isHeld ? "Resume" : "Pause"; if (pauseBtn.textContent !== t) pauseBtn.textContent = t; }, 250);
  $("again").addEventListener("click", () => {
    if (session.phase === "summary" && session.runNo === 1) session.enter();
    else { try { window.location.hash = "#/home"; } catch { /* */ } window.location.reload(); }
  });
  $("go").addEventListener("click", () => stage.focus());
  doc.addEventListener("keydown", e => { if (e.key === "Escape" && app.router?.page === "about") { e.preventDefault(); app.router.go(pageOfPhase(session.phase)); } });
  if (op) {
    $("op-latency").textContent = `${r.latencyMs} ms${r.latencyMs > 50 ? " (over 50, check headphones are wired)" : ""}`;
    $("op-motion").textContent = `${r.motion}, mode ${audio.mode}`;
    $("op-output").textContent = "app voice";
    $("op-voice").textContent = "am_michael";
  }

  const stage = $("stage");
  const attach = () => attachKeys(stage, session);   // in the full flow the interior keys start when the walker is inside
  // The view inside is first person on the real scan mesh ("mesh"), from the first frame, and it never changes on its own.
  // The Matterport photo view ("first") is mounted only when the visitor presses V; V again returns to the mesh. It is
  // mounted once and kept (its host sits behind the opaque scan), so switching back and forth never leaks an iframe.
  let showcase: ShowcaseHandle | null = null;
  let mounting = false;
  let photoOn = false;
  const setView = (photo: boolean) => { stage.dataset.view = photo ? "first" : "mesh"; };
  setView(false);
  const note = (text: string | null) => { const n = $("photo-note"); n.textContent = text ?? ""; n.hidden = text === null; };
  const mountPhoto = () => {
    const fail = (why?: unknown) => {
      if (why !== undefined && typeof why !== "string") console.error("photo view failed; first person on the mesh instead", why);
      const wanted = photoOn;
      showcase = null; mounting = false; photoOn = false; setView(false);
      $("showcase").hidden = true;
      if (wanted) note(FALLBACK_LINE);   // only ever after the visitor chose the photo view
    };
    mounting = true;
    const load = (): Promise<Awaited<ReturnType<typeof loadShowcase>>> => { try { return loadShowcase(); } catch (e) { return Promise.reject(e); } };
    void load().then(mod => {
      if (!mod) { fail("no showcase module"); return; }
      // The Showcase iframe must be laid out and visible while it connects: hidden (display:none, 0x0) or
      // visibility:hidden, Chrome never renders it and App.state never reaches PLAYING. It loads behind the opaque
      // scan (.room3d z-index 1); onReady shows it only if the visitor still wants the photo view.
      $("showcase").hidden = false;
      return mod.mountShowcase({ host: $("showcase"), pkg, world: ex.world, bus: speech.bus,
        say: (t: string, p?: 1 | 2 | 3) => { if (photoOn) speech.say(t, p ?? 2); },
        onReady: () => { mounting = false; if (photoOn) { setView(true); note(null); } }, onFail: fail, safeTop: 70, safeBottom: 170 })
        .then(h => { if (h.ready) showcase = h; }).catch(fail);
    }).catch(fail);
  };
  const togglePhoto = () => {
    speech.stop();
    photoOn = !photoOn;
    note(null);
    if (!photoOn) { setView(false); speech.say(PHOTO_OFF_LINE, 2); return; }
    speech.say(PHOTO_ON_LINE, 2);
    if (showcase?.ready) { setView(true); showcase.setPose(ex.traveller.pos, ex.traveller.heading); }
    else if (!mounting) safely("the photo view", mountPhoto, () => { photoOn = false; setView(false); note(FALLBACK_LINE); });
  };
  let photoKey = false;
  const attachPhotoKey = () => {
    if (photoKey || phone) return;
    photoKey = true;
    stage.addEventListener("keydown", e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.key.toLowerCase() !== "v") return;
      if (doc.body.dataset.page !== "inside") return;
      e.preventDefault(); togglePhoto();
    });
  };
  setInterval(() => { if (showcase?.ready) showcase.setPose(ex.traveller.pos, ex.traveller.heading); }, 100);
  if (!full) attach();
  // #/check hides the stage, so its keys (arrows and Space to point, 1 to 4 to answer, Enter) are caught on the page itself;
  // a focused button inside keeps its own Enter and Space (F6 reaches them).
  for (const sec of [$("check"), $("result")]) {   // the summary page too (Enter starts run 2, Space repeats)
    sec.tabIndex = -1;
    sec.addEventListener("keydown", e => { if (e.target !== sec) e.stopPropagation(); }, true);
    attachKeys(sec, session);
  }
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
  const keycard = mountKeyCard(doc, stage, t => speech.say(t, 1), () => speech.stop());
  mountKeyPill(doc);
  const beginInterior = () => {
    // Each step is guarded: whatever fails, the visitor lands on #/inside with the keys (never back on Home).
    if (full) safely("interior keys", () => { attach(); doc.body.dataset.flow = "inside"; $("room3d").hidden = false; });
    safely("the view", () => { setView(false); attachPhotoKey(); });   // the scan mesh; Matterport only on V
    if (!safely("showing Explore", () => showPhase(doc, session, "explore", app.router))) safeInside(app, doc);
    if (!safely("starting Explore", () => ex.begin())) { safeInside(app, doc); return; }
    safely("the intro", () => {
      // Status, ear check (Review Focus 9) and the Explore intro in one line, so nothing is dropped.
      if (card && r.audio === "running") { keycard.show(true); }   // the key card replaces the guided intro on a first visit
      else if (r.audio === "running" && session.startIntro()) { /* the guided intro speaks first: one key at a time */ }
      else speech.say(`${audio.statusLine(r)} Ear check: a tap left, then right. If that was backwards, press Shift and S. ${ex.intro(phone)}`, 2);
      audio.play(1, { pan: -1, send: 0 });
      setTimeout(() => safely("the ear check", () => audio.play(1, { pan: 1, send: 0 })), 500);
    });
  };
  if (!full) { beginInterior(); return; }
  app.router?.go("arrive", true);
  // ?flow=full: Home, fly in, curb walk (outdoor hook), then the interior at pkg.entrances[0] (see flow.ts for the contract).
  void loadOutdoorHook().then(hook => runFlow({
    hook, pkg, stage, say: (t, p) => speech.say(t, p ?? 2), bus: speech.bus, audio, begin: beginInterior,
    onOutdoor: on => { doc.body.dataset.flow = on ? "arrive" : "inside"; $("room3d").hidden = on; if (!on) { app.router?.go("inside", true); const n = $("next-action"); n.textContent = (n.textContent ?? "").replace("skip the fly-in and start the walk to the door", "start the rehearsal"); } },   // through the door: #/arrive becomes #/inside
  }));
}

const LEDE: Record<Phase, string> = {
  explore: "Explore by sound. Walk, turn and listen. Nothing is scored.",
  rehearse: "Rehearse the way in, one stretch at a time. Follow the spoken directions.",
  point: "Turn to face the destination, then confirm.",
  quiz: "Three questions about the route.",
  summary: "Pocket summary. Take it with you.",
};
const GO: Partial<Record<Phase, string>> = {
  explore: "Start rehearsal", point: "Continue", quiz: "Next question", summary: "Start run 2",
};

/** The page a session phase lives on. */
export function pageOfPhase(p: Phase): Page { return p === "explore" || p === "rehearse" ? "inside" : p === "summary" ? "summary" : "check"; }

const results: Record<number, RunResult> = {};

function showPhase(doc: Document, s: Session, p: Phase, router?: Router): void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T;
  doc.body.dataset.phase = p;
  $("lede").textContent = LEDE[p];
  const go = $<HTMLButtonElement>("go");
  const label = p === "summary" && s.runNo === 2 ? undefined : GO[p];
  go.hidden = !label || (p === "explore" && !s.hasRoute);
  if (label) go.textContent = label;
  const step = doc.getElementById("step");
  if (step) step.firstChild!.textContent = p === "point" ? "Confirm" : p === "quiz" || p === "summary" ? "Continue" : "Step";
  const hint = doc.querySelector(".step-button__hint");
  if (hint) hint.textContent = p === "point" ? "Tap to confirm where you point" : "Tap to take one step";
  if (p === "summary") {
    const log = s.run?.log;
    if (log) results[s.runNo] = { quizOk: log.quiz.filter(x => x.correct).length, quizTotal: log.quiz.length,
      pointDeg: log.point.length ? Math.round(log.point[log.point.length - 1].error_deg) : null, bumps: log.events.filter(e => e.kind === "bump").length };
    renderScore($("score"), results);
    $("again").textContent = s.runNo === 1 ? "Practice again" : "Start over";
    $("summary").hidden = false;
    const draw = (fp: boolean) => renderSummary($("summary"), s.pkg, s.route!, { floorPlan: fp });
    draw(false);
    void floorPlanAvailable(s.pkg.id).then(draw);
    const c = s.coach;
    const line = $("coach-line");
    line.hidden = !c || s.runNo !== 1;
    if (c) line.textContent = `${c.line} (${c.source === "agent" ? "coach" : "scripted"})`;
  } else $("coach-line").hidden = true;
  const want = pageOfPhase(p);
  if (router && router.page !== "arrive" && router.page !== want) router.go(want, true);
}

/** #/inside never scrolls: arrows, Space and page keys never reach the browser's scroller (Space still presses a focused button). */
export function lockScroll(doc: Document): void {
  doc.addEventListener("keydown", e => {
    const p = doc.body.dataset.page;
    if (p !== "inside" && p !== "arrive") return;
    const t = e.target as HTMLElement | null;
    const onControl = !!t?.closest?.("button, a, input, select, textarea, summary");
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"].includes(e.key) || (e.key === " " && !onControl)) e.preventDefault();
  });
}

/** Focus and the arrival line for each page. */
function onPage(app: App, doc: Document, p: Page, prev: Page | null, started: boolean): void {
  const $ = (id: string) => doc.getElementById(id);
  if (p === "home") { $("start")?.focus(); return; }
  if (p === "about") { app.session?.timer.stop(); const h = $("about-h"); h?.setAttribute("tabindex", "-1"); h?.focus(); }
  else { if (prev === "about") app.session?.timer.start(); ($(p === "check" ? "check" : p === "summary" ? "result" : "stage") as HTMLElement | null)?.focus(); }
  if (!started || p === prev) return;
  if (prev === "arrive" && p === "inside") { const c = $("say-polite"); if (c) c.textContent = ""; const d = $("say-dir"); if (d) { d.replaceChildren(); d.hidden = true; } }   // the outdoor caption does not linger
  const line = PAGE_LINES[p];
  if (!line) return;
  const say = () => app.speech.say(line, 1);
  if (p === "arrive" || p === "about") say();
  else setTimeout(() => { if (app.speech.busyPri === null) say(); }, 2500);   // after the phase's own lines, never over them
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

/** The way out of the stage (WCAG 2.1.2): Escape with nothing running, or F6 / Shift+F6 to cycle the parts of this page. */
export function wireRegions(doc: Document, stage: HTMLElement, speech: Speech, session: Session): () => void {
  const page = () => doc.body.dataset.page ?? "inside";
  const regions: [string, () => HTMLElement | null][] = [
    ["Rehearsal.", () => page() === "inside" || page() === "arrive" ? stage : doc.getElementById(page() === "check" ? "check" : page() === "summary" ? "result" : "") ],
    ["Controls.", () => page() === "home" ? doc.getElementById("start") : page() === "about" ? doc.getElementById("about-back")
      : page() === "check" ? (doc.querySelector<HTMLElement>("#quiz button") ?? doc.getElementById("go"))
      : page() === "summary" ? doc.getElementById("again") : doc.getElementById("pause")],
    ["", () => page() === "about" ? doc.querySelector<HTMLElement>(".objects__scroll") : null],
    ["Keys.", () => page() === "about" ? doc.querySelector<HTMLElement>("#keys-panel > summary") : null],
    ["Agent and data.", () => page() === "about" ? doc.querySelector<HTMLElement>("#data-panel > summary") : null],
  ];
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "F6") return;
    e.preventDefault();
    const inside = regions.map(([, f]) => { const el = f(); return !!el && (el === doc.activeElement || el.contains(doc.activeElement)); });
    const at = inside.lastIndexOf(true);   // the 3D bar sits inside the stage: the most specific (last) region wins
    const n = regions.length, dir = e.shiftKey ? -1 : 1;
    let i = ((at < 0 ? 0 : at + dir) + n) % n;
    for (let k = 0; k < n && !regions[i][1](); k++) i = (i + dir + n) % n;   // skip a part this page does not have
    const [name, f] = regions[i];
    f()?.focus();
    speech.stop();
    if (name) speech.say(name, 2);
  };
  doc.addEventListener("keydown", onKey);
  void session;
  return () => doc.removeEventListener("keydown", onKey);
}
