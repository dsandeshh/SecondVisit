// Dev page for the first person Showcase view. http://localhost:5173/showcase.html?b=x37LjPx62VA
// Up walks, Left/Right turn, Down back. ?at=x,y,h starts there. window.__sc exposes the handle for screenshots.
import type { BuildingPackage } from "./types";
import { CueBus } from "./events";
import { mountShowcase, type ShowcaseHandle } from "./showcase";
import { Traveller, World } from "./world";

const q = new URLSearchParams(location.search);
const host = document.getElementById("host")!, note = document.getElementById("note")!;
const w = window as any;

async function main(): Promise<void> {
  const pkg = (await (await fetch(`/buildings/${q.get("b") ?? "x37LjPx62VA"}/package.json`)).json()) as BuildingPackage;
  const world = new World(pkg), bus = new CueBus();
  const ent = pkg.entrances[0];
  const at = (q.get("at") ?? "").split(",").map(Number);
  const t = new Traveller(world, at.length === 3 ? [at[0], at[1]] : ent.pos, at.length === 3 ? at[2] : ent.heading_deg);
  bus.listener = { pos: t.pos, heading: t.heading };
  note.textContent = "connecting...";
  let h: ShowcaseHandle;
  try {
    h = await mountShowcase({ host, pkg, world, bus, route: pkg.routes[+(q.get("route") ?? 0)], say: s => (note.textContent = s), onFail: r => { w.__failAt = performance.now(); w.__failWhy = r; note.textContent = "Photo view needs internet; showing the scan."; } });
    if (!h.ready) return;
  } catch { note.textContent = "Photo view needs internet; showing the scan."; return; }
  w.__sc = { h, t, bus };
  const sync = (): void => { bus.listener = { pos: t.pos, heading: t.heading }; h.setPose(t.pos, t.heading); };
  if (at.length === 3) sync();
  note.textContent = `ready: cal ${(h.calibration!.meanErr * 100).toFixed(1)} cm, mirrored=${h.calibration!.mirrored}`;
  w.__sc.sync = sync;
  host.focus();
  host.addEventListener("keydown", e => {
    if (e.key === "ArrowUp") t.step(1); else if (e.key === "ArrowDown") t.step(-1);
    else if (e.key === "ArrowLeft") t.turn(-15); else if (e.key === "ArrowRight") t.turn(15); else return;
    e.preventDefault(); sync();
  });
}
void main();
