// Home: ONE address box (UI_DESIGN 4.2b item 1). Submit resolves the place and hands back a building id.
// Resolution: GET /api/resolve?q= (engine resolver, offline); if the engine is not running, a fixed list backs the demo
// so the clinic address or name always resolves. Nothing plays or speaks here: the submit click is the gesture the
// caller uses to start audio (onGesture runs synchronously, before any await).
import "./home.css";

/** ready: a built package opens. outdoor: a real Houston or LA model with no package yet (no indoor rehearsal).
 * A place that resolves to neither is `null` (tier "none"). */
export type Tier = "ready" | "outdoor";
export type Resolved = { sid: string; name: string; address: string; via: "engine" | "list"; tier?: Tier; city?: string };   // no tier = ready

/** The tier lines, said in Michael's voice and shown under the box (every literal is in FIXED_UI_LINES). */
export const NO_INDOOR_LINE = "No indoor scan yet for this building.";
export const NOT_AVAILABLE_LINE = "This building is not available yet.";
export const CHOOSE_BELOW_LINE = "Choose one of the buildings below.";

export function tierLines(r: Resolved | null): string[] {
  if (!r) return [NOT_AVAILABLE_LINE, CHOOSE_BELOW_LINE];
  return r.tier === "outdoor" ? [NO_INDOOR_LINE, CHOOSE_BELOW_LINE] : [];
}
export type HomeOpts = {
  onGesture?: () => void;
  onResolved: (r: Resolved) => void;
  fetcher?: typeof fetch;
  initial?: string;
};

type Entry = { sid: string; name: string; address: string; re: RegExp };
/** The fixed offline list: every building with a built package (the clinic, Office B in the same complex, the fixture).
 * Office B comes first so "Office B, 7400 FM-1960 W" picks it; the bare shared address still means the clinic. */
export const OFFLINE: Entry[] = [
  { sid: "hpGRjK5uFPW", name: "Office B", address: "7400 FM-1960 W, Houston, TX 77070", re: /\boffice\s*b\b/i },
  { sid: "x37LjPx62VA", name: "Medical Office", address: "7400 FM-1960 W, Houston, TX 77070", re: /\b7400\b|medical\s+office|fm[\s-]*1960\s*w|clinic/i },
  { sid: "fixture", name: "Demo lobby", address: "Built in demo building", re: /fixture|demo|lobby/i },
];

export function offlineResolve(q: string): Resolved | null {
  const e = OFFLINE.find(x => x.re.test(q));
  return e ? { sid: e.sid, name: e.name, address: e.address, via: "list", tier: "ready" } : null;
}

export async function resolveAddress(q: string, fetcher: typeof fetch = (...a) => fetch(...a), timeoutMs = 2500): Promise<Resolved | null> {
  const text = q.trim();
  if (!text) return null;
  try {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    const r = await fetcher(`/api/resolve?q=${encodeURIComponent(text)}`, { signal: ctl?.signal });
    if (t) clearTimeout(t);
    if (r.ok && !/text\/html/.test(r.headers?.get?.("content-type") ?? "")) {
      const j = await r.json();
      if (j?.sid) return { sid: j.sid, name: j.name ?? j.sid, address: j.address ?? "", via: "engine",
        tier: j.tier === "outdoor" ? "outdoor" : "ready", ...(j.city ? { city: j.city } : {}) };
    }
  } catch { /* the engine is not running: the list below */ }
  return offlineResolve(text);
}

export const NOT_FOUND = "We could not find that place. Check the street number, or type the building name, such as Medical Office.";

export function mountHome(host: HTMLElement, o: HomeOpts): { destroy(): void; input: HTMLInputElement } {
  const doc = host.ownerDocument;
  const root = doc.createElement("section");
  root.className = "home";
  root.setAttribute("aria-labelledby", "home-title");
  root.innerHTML = `
    <p class="home__mark">SecondVisit</p>
    <form class="home__form" novalidate>
      <h1 id="home-title" class="home__title">Where is your appointment?</h1>
      <div class="home__row">
        <label class="sr-only" for="home-q">Address or building name</label>
        <input id="home-q" class="home__input" name="q" type="text" inputmode="text" autocomplete="street-address" autocapitalize="words"
               spellcheck="false" placeholder="Street address or building name" aria-describedby="home-note home-err" />
        <button class="btn btn--primary home__go" type="submit">Find it</button>
      </div>
      <p id="home-err" class="home__err" role="alert"></p>
      <p id="home-note" class="home__note">Make your first visit your second. Nothing plays until you press Find it.</p>
    </form>`;
  host.append(root);
  const form = root.querySelector("form")!, input = root.querySelector<HTMLInputElement>("input")!;
  const err = root.querySelector<HTMLElement>("#home-err")!, go = root.querySelector<HTMLButtonElement>("button")!;
  if (o.initial) input.value = o.initial;
  let busy = false;
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    if (busy) return;
    err.textContent = "";
    if (!input.value.trim()) { err.textContent = "Type the street address or the building name first."; input.focus(); return; }
    busy = true; go.disabled = true; go.textContent = "Finding";
    try { o.onGesture?.(); } catch { /* the caller's audio start must not stop the search */ }
    const r = await resolveAddress(input.value, o.fetcher);
    busy = false; go.disabled = false; go.textContent = "Find it";
    if (!r) { err.textContent = NOT_FOUND; input.focus(); return; }
    if (r.tier === "outdoor") { err.textContent = `${r.name}. ${tierLines(r).join(" ")}`; input.focus(); return; }
    o.onResolved(r);
  });
  queueMicrotask(() => input.focus());
  return { input, destroy: () => root.remove() };
}
