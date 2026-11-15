/** Matterport Showcase tour for the observer side panel (Task 18 P1). Pure decision plus a small DOM mount. */
export type TourDecision = { show: true; src: string } | { show: false; note: string };

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const SID = /^[A-Za-z0-9]{6,20}$/;

/** Localhost only (sponsor data never goes into a public link); hidden when the model is private. */
export function tourDecision(host: string, sid: string, visibility?: string | null, sdkKey?: string): TourDecision {
  if (!LOCAL.has(host)) return { show: false, note: "Showcase tour is shown on localhost only." };
  if (!SID.test(sid)) return { show: false, note: "Showcase tour not available for this building." };
  const v = (visibility ?? "").toLowerCase();
  if (v && v !== "public" && v !== "unlisted") return { show: false, note: "Showcase tour not available: the model is private." };
  const key = sdkKey ? `&applicationKey=${encodeURIComponent(sdkKey)}` : "";
  return { show: true, src: `https://my.matterport.com/show/?m=${sid}&play=1&qs=1${key}` };
}

export function mountTour(box: HTMLElement, sid: string, visibility?: string | null): void {
  const key = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_MATTERPORT_SDK_KEY;
  const d = tourDecision(location.hostname, sid, visibility, key);
  box.replaceChildren();
  if (!d.show) { box.setAttribute("role", "status"); box.textContent = d.note; return; }
  const f = document.createElement("iframe");
  f.src = d.src; f.title = "Matterport Showcase tour"; f.allow = "fullscreen; xr-spatial-tracking";
  f.referrerPolicy = "no-referrer";
  f.style.cssText = "width:100%;height:100%;border:0";
  let loaded = false;
  f.addEventListener("load", () => { loaded = true; });
  box.appendChild(f);
  setTimeout(() => { if (!loaded) { box.replaceChildren(); box.setAttribute("role", "status"); box.textContent = "Showcase tour did not load (offline?). The rehearsal is not affected."; } }, 8000);
}
