// Standalone dev page for step 6: home -> fly in -> curb walk -> onInside, without main.ts.
// http://localhost:5175/outdoor.html   (?b=<sid> skips typing, ?auto=1 walks by itself, ?skip=1 skips the flight,
// ?reduced=1 forces reduced motion). Needs the engine only for /api/resolve; the fixed list backs it offline.
import "./styles/tokens.css";
import "./styles/app.css";
import { AudioEngine } from "./audio/engine";
import { Speech } from "./audio/speech";
import { ClipStore, VoiceOut } from "./audio/voice";
import { loadPackage } from "./app";
import { mountHome, type Resolved } from "./home/home";
import { startOutdoor } from "./outdoor_hook";

const q = new URLSearchParams(location.search);
const app = document.getElementById("app")!;
const speech = new Speech({});
const audio = new AudioEngine(speech);
(window as any).__sv = { audio, speech };

let started: Promise<unknown> | null = null;
const home = mountHome(app, {
  initial: q.get("q") ?? "",
  onGesture: () => { if (!audio.ctx) started = audio.start("app"); },
  onResolved: r => void run(r),
});

async function run(r: Resolved): Promise<void> {
  home.destroy();
  const pkg = await loadPackage(r.sid);
  await started?.catch(() => undefined);
  if (audio.ctx) { // no AudioContext without a gesture (?b= skips the home click): browser speech only
    const store = new ClipStore(audio.ctx, `/buildings/${pkg.id}`);
    new VoiceOut(audio, speech, store);
    void store.init().then(() => store.preload()).catch(() => undefined);
  }
  const stage = document.createElement("div");
  stage.className = "stage"; stage.setAttribute("role", "application"); stage.tabIndex = 0;
  stage.setAttribute("aria-label", "Outdoor walk from the drop off to the door");
  Object.assign(stage.style, { position: "relative", width: "100vw", height: "100vh", padding: "0", border: "0" });
  app.append(stage);
  stage.focus();
  const h = await startOutdoor({
    pkg, stage, bus: speech.bus, audio, say: (t, p) => speech.say(t, p ?? 2),
    reducedMotion: q.get("reduced") === "1" ? true : undefined, autoWalk: q.get("auto") === "1", skipFlyIn: q.get("skip") === "1",
    onInside: () => {
      const end = document.createElement("p");
      end.id = "inside"; end.textContent = "Inside. The interior starts here.";
      Object.assign(end.style, { position: "fixed", inset: "0", display: "grid", placeItems: "center", margin: "0", font: "700 2rem system-ui", background: "var(--c-paper)", color: "var(--c-ink)" });
      app.append(end);
    },
  });
  (window as any).__od = h;
}

const b = q.get("b");
if (b) void run({ sid: b, name: b, address: "", via: "list" }).then(() => { /* no gesture: sound stays off until a click */ });
