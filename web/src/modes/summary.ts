// Pocket summary: numbered instructions, read aloud one per Space, driver message with Copy (Task 9).
import type { BuildingPackage, Route } from "../types";
import type { Priority } from "../audio/speech";

export const summaryLines = (route: Route): string[] => route.segments.map(s => s.instruction);

export class SummaryReader {
  private i = 0;
  constructor(private lines: string[], private say: (t: string, p?: Priority) => void) {}
  next(): void {
    if (this.i >= this.lines.length) {
      this.i = 0;
      this.say("End of the summary. Press Space to hear it again from the start.", 2);
      return;
    }
    this.say(`Stretch ${this.i + 1}. ${this.lines[this.i]}`, 2);
    this.i++;
  }
}

export const LIMITS_NOTE = "SecondVisit helps you prepare. It does not replace your cane, your guide dog or mobility training.";

export async function floorPlanAvailable(id: string, f: typeof fetch = fetch): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([f(`/buildings/${id}/floorplan.json`), f(`/buildings/${id}/floorplan.jpg`)]);
    const ct = (r: Response) => r.headers?.get?.("content-type") ?? "";
    return a.ok && b.ok && !/text\/html/.test(ct(a)) && !/text\/html/.test(ct(b)); // Vite serves index.html for misses
  } catch { return false; }
}

function el<K extends keyof HTMLElementTagNameMap>(d: Document, tag: K, text = "", cls = ""): HTMLElementTagNameMap[K] {
  const e = d.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

/** Builds the summary into `host` (replaces its content). `floorPlan` says whether the helper's plan exists. */
export function renderSummary(host: HTMLElement, pkg: BuildingPackage, route: Route, opts: { floorPlan: boolean }): void {
  const d = host.ownerDocument;
  host.replaceChildren();
  host.append(el(d, "h2", "Pocket summary"));
  const ol = el(d, "ol", "", "summary__list");
  summaryLines(route).forEach(t => ol.append(el(d, "li", t)));
  host.append(ol);
  const a = pkg.arrival;
  if (a?.driver_message) {
    const box = el(d, "section", "", "summary__driver");
    box.setAttribute("aria-label", "Driver message");
    box.append(el(d, "h3", "Driver message"), el(d, "p", a.driver_message));
    const b = el(d, "button", "Copy driver message", "btn btn--secondary");
    b.type = "button";
    b.addEventListener("click", () => {
      void navigator.clipboard?.writeText(a.driver_message).then(() => { b.textContent = "Copied"; }, () => { b.textContent = "Copy failed. Select the text above."; });
    });
    box.append(b);
    host.append(box);
  }
  if (a?.image_url) {
    const img = el(d, "img", "", "summary__img");
    img.src = a.image_url;
    img.alt = `Aerial photo, north at the top. Drop off point on the ${a.entrance_side} side by the main entrance.`;
    host.append(img);
  }
  const helper = el(d, "section", "", "summary__helper");
  helper.append(el(d, "h3", "For a sighted helper"));
  helper.append(el(d, "p", opts.floorPlan ? "Floor plan: see the observer view." : "Floor plan not available for this building.", "note"));
  host.append(helper);
  host.append(el(d, "p", LIMITS_NOTE, "note"));
}
