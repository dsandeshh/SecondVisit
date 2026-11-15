// The story home (`?home=story`), for sighted judges only: a silent 14 s line drawing behind the home form.
// A car pulls away from the kerb, the walker (the one yellow mark) stays, a pulse starts at a door, the blue route
// draws itself with step ticks, the walker follows it under the canopy, the view carries through the door and a
// second route draws to the desk inside. aria-hidden, no focusable descendant, pointer-events none, no sound; under
// prefers-reduced-motion one static frame. The layer is absolutely placed and fixed in size, so nothing shifts.
// `?home=plain` or no param keeps the plain home; `?storyt=<s>` freezes the loop at that second (screenshots).

export type HomeVariant = "plain" | "story";
export const homeVariant = (params: URLSearchParams): HomeVariant => (params.get("home") === "story" ? "story" : "plain");

export const LOOP_S = 14;
/** The one frame shown under reduced motion: the route drawn, the walker on it, the pulse at the door. */
export const STATIC_T = 8.2;

type Pt = [number, number];
type Cubic = [Pt, Pt, Pt, Pt];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const easeIn = (x: number) => x * x * x;
const bez = ([a, b, c, d]: Cubic, u: number): Pt => {
  const v = 1 - u;
  return [v * v * v * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * c[0] + u * u * u * d[0],
    v * v * v * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * c[1] + u * u * u * d[1]];
};

/** A route sampled once: points with cumulative length, so drawing, ticks and the walker share one arc length. */
class Route {
  readonly pts: Pt[] = [];
  readonly acc: number[] = [];
  readonly d: string;
  constructor(segs: Cubic[]) {
    this.d = `M${segs[0][0].join(" ")}` + segs.map(s => ` C${s[1].join(" ")} ${s[2].join(" ")} ${s[3].join(" ")}`).join("");
    for (const s of segs) for (let i = this.pts.length ? 1 : 0; i <= 60; i++) this.pts.push(bez(s, i / 60));
    let L = 0;
    this.pts.forEach((p, i) => { if (i) L += Math.hypot(p[0] - this.pts[i - 1][0], p[1] - this.pts[i - 1][1]); this.acc.push(L); });
  }
  get length(): number { return this.acc[this.acc.length - 1]; }
  /** Point and unit tangent at arc length s. */
  at(s: number): { p: Pt; t: Pt } {
    s = Math.min(this.length, Math.max(0, s));
    let i = this.acc.findIndex(a => a >= s);
    if (i <= 0) i = 1;
    const a = this.pts[i - 1], b = this.pts[i];
    const seg = this.acc[i] - this.acc[i - 1] || 1, u = (s - this.acc[i - 1]) / seg;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], t: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] };
  }
}

const NS = "http://www.w3.org/2000/svg";
const DOOR: Pt = [1226, 256];
const OUT = new Route([
  [[362, 352], [540, 356], [660, 362], [800, 358]],
  [[800, 358], [960, 352], [1150, 332], [1226, 304]],
]);
const IN = new Route([[[790, 404], [800, 372], [880, 352], [960, 346]]]);
const TICK_GAP = 34;

// Facade windows: three rows, five columns, the door bay left open.
const windows = (): string => {
  let s = "";
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    const x = 1012 + c * 100, y = 66 + r * 46;
    s += `<rect x="${x}" y="${y}" width="56" height="28" />`;
  }
  return s;
};

const figure = (cls: string) => `
  <g class="${cls}">
    <line class="st-leg st-leg--a" x1="-3" y1="-22" x2="-4" y2="0" />
    <line class="st-leg st-leg--b" x1="3" y1="-22" x2="4" y2="0" />
    <rect class="st-body" x="-9" y="-58" width="18" height="38" rx="9" />
    <circle class="st-body" cx="0" cy="-70" r="8.5" />
    <line class="st-cane" x1="8" y1="-38" x2="34" y2="0" />
  </g>`;

const SVG = `
<svg class="home-story__svg" viewBox="0 0 1600 420" preserveAspectRatio="xMidYMax slice" focusable="false" aria-hidden="true">
  <g class="st-out">
    <g class="st-street">
      <line class="st-hair" x1="0" y1="300" x2="980" y2="300" />
      <line x1="0" y1="362" x2="1600" y2="362" />
      <line class="st-hair" x1="0" y1="372" x2="1600" y2="372" />
      <rect class="st-hair" x="724" y="314" width="64" height="26" />
      <path class="st-hair" d="M732 314 C736 296 748 290 756 290 C766 290 778 298 780 314" />
      <line class="st-hair" x1="56" y1="362" x2="56" y2="250" /><circle class="st-hair" cx="56" cy="244" r="6" />
    </g>
    <g class="st-bldg">
      <path d="M980 300 V40 H1520 V300" />
      <line class="st-hair" x1="980" y1="300" x2="1600" y2="300" />
      <g class="st-hair">${windows()}</g>
      <rect class="st-door" x="1198" y="212" width="56" height="88" />
      <line class="st-hair" x1="1226" y1="212" x2="1226" y2="300" />
      <path class="st-canopy" d="M1164 188 H1288 L1278 202 H1174 Z" />
    </g>
    <g class="st-pulse"><circle class="st-ring" cx="${DOOR[0]}" cy="${DOOR[1]}" r="0" /><circle class="st-ring" cx="${DOOR[0]}" cy="${DOOR[1]}" r="0" /></g>
    <path class="st-route st-route--out" d="${OUT.d}" />
    <g class="st-ticks st-ticks--out"></g>
    <g class="st-car">
      <path class="st-carbody" d="M0 60 V40 Q0 31 10 29 L62 24 L98 5 Q104 1 112 1 H176 Q186 1 193 9 L216 28 L250 32 Q262 34 262 46 V60 Z" />
      <path class="st-hair" d="M106 10 H140 V26 H76 Z M150 10 H180 L198 26 H150 Z" />
      <circle class="st-wheel" cx="54" cy="62" r="14" /><circle class="st-wheel" cx="208" cy="62" r="14" />
    </g>
    ${figure("st-walker st-walker--out")}
  </g>
  <g class="st-in">
    <path class="st-wall" pathLength="1" d="M560 72 H1040 V250 H560 Z" />
    <path class="st-wall" pathLength="1" d="M560 250 L236 420 M1040 250 L1364 420 M560 72 L380 22 M1040 72 L1220 22" />
    <path class="st-wall st-hair" pathLength="1" d="M640 250 V140 H712 V250" />
    <path class="st-wall" pathLength="1" d="M900 340 V292 H1090 V340 M900 292 L934 270 H1112 L1090 292 M1112 270 V318 L1090 340" />
    <path class="st-route st-route--in" d="${IN.d}" />
    <g class="st-ticks st-ticks--in"></g>
    ${figure("st-walker st-walker--in")}
  </g>
</svg>`;

function ticks(host: Element, r: Route): SVGLineElement[] {
  const out: SVGLineElement[] = [];
  for (let s = TICK_GAP; s < r.length - 8; s += TICK_GAP) {
    const { p, t } = r.at(s);
    const l = host.ownerDocument.createElementNS(NS, "line");
    l.setAttribute("x1", String(p[0] - t[1] * 7)); l.setAttribute("y1", String(p[1] + t[0] * 7));
    l.setAttribute("x2", String(p[0] + t[1] * 7)); l.setAttribute("y2", String(p[1] - t[0] * 7));
    l.dataset.s = String(s);
    host.append(l); out.push(l);
  }
  return out;
}

export interface Story { el: HTMLElement; draw(t: number): void; running(): boolean; stop(): void }

/** Mounts the story layer into the home section (last child, outside the Tab order) and starts the loop. */
export function mountStory(doc: Document, params: URLSearchParams = new URLSearchParams()): Story | null {
  const home = doc.getElementById("home");
  if (!home) return null;
  const win = doc.defaultView;
  home.dataset.home = "story";
  const el = doc.createElement("div");
  el.className = "home-story";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = SVG;
  home.append(el);

  const q = <T extends Element>(s: string) => el.querySelector(s) as T;
  const out = q<SVGGElement>(".st-out"), inside = q<SVGGElement>(".st-in"), car = q<SVGGElement>(".st-car");
  const rings = Array.from(el.querySelectorAll<SVGCircleElement>(".st-ring"));
  const rOut = q<SVGPathElement>(".st-route--out"), rIn = q<SVGPathElement>(".st-route--in");
  const tOut = ticks(q(".st-ticks--out"), OUT), tIn = ticks(q(".st-ticks--in"), IN);
  const wOut = q<SVGGElement>(".st-walker--out"), wIn = q<SVGGElement>(".st-walker--in");
  const walls = Array.from(el.querySelectorAll<SVGPathElement>(".st-wall"));
  const legs = (w: Element) => Array.from(w.querySelectorAll<SVGLineElement>(".st-leg"));
  const cane = (w: Element) => w.querySelector<SVGLineElement>(".st-cane")!;
  for (const [p, r] of [[rOut, OUT], [rIn, IN]] as const) p.style.strokeDasharray = `${r.length} ${r.length}`;

  const reveal = (path: SVGPathElement, list: SVGLineElement[], r: Route, k: number) => {
    path.style.strokeDashoffset = String(r.length * (1 - k));
    for (const l of list) l.style.opacity = Number(l.dataset.s) <= r.length * k ? "1" : "0";
  };
  const pose = (w: SVGGElement, p: Pt, scale: number, stride: number) => {
    w.setAttribute("transform", `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)}) scale(${scale.toFixed(3)})`);
    const sw = Math.sin(stride) * 5;
    const [a, b] = legs(w);
    a.setAttribute("x2", String(-4 + sw)); b.setAttribute("x2", String(4 - sw));
    const c = cane(w);   // the cane tip sweeps a little ahead with each step
    c.setAttribute("x2", String(34 + Math.cos(stride) * 4));
  };

  const draw = (tt: number) => {
    const t = ((tt % LOOP_S) + LOOP_S) % LOOP_S;
    const fade = span(t, 0, 0.5) * (1 - span(t, 13.2, 14));
    el.style.opacity = fade.toFixed(3);

    // 1. The car pulls away to the left and leaves the frame.
    const c = easeIn(span(t, 0.6, 2.8));
    car.setAttribute("transform", `translate(${(110 - c * 720).toFixed(1)} 340)`);

    // 2. The pulse from the door: two rings, 1.4 s apart, from 2.6 s until the walker is through the door.
    rings.forEach((ring, i) => {
      const on = t >= 2.6 && t < 10.2;
      const ph = on ? (((t - 2.6) / 1.4 + i * 0.5) % 1) : 0;
      ring.setAttribute("r", (6 + ph * 84).toFixed(1));
      ring.style.opacity = on ? ((1 - ph) * 0.55).toFixed(3) : "0";
    });

    // 3. The route draws itself to the door, step ticks appearing with it.
    reveal(rOut, tOut, OUT, easeInOut(span(t, 4.0, 6.8)));

    // 4. The walker follows it, smaller as it nears the facade, under the canopy and in.
    const w = easeInOut(span(t, 7.0, 10.2));
    const at = OUT.at(w * OUT.length).p;
    pose(wOut, at, 1 - ((352 - at[1]) / 48) * 0.18, w * OUT.length / 9);

    // 5. The view carries through the door.
    const push = easeIn(span(t, 10.0, 11.0));
    const s = 1 + push * 7;
    out.setAttribute("transform", `translate(${DOOR[0]} ${DOOR[1]}) scale(${s.toFixed(3)}) translate(${-DOOR[0]} ${-DOOR[1]})`);
    out.style.opacity = (1 - span(t, 10.3, 11.0)).toFixed(3);

    // 6. Inside: walls resolve as thin lines, then a second route draws to the desk.
    inside.style.opacity = span(t, 10.6, 11.0).toFixed(3);
    walls.forEach((p, i) => { p.style.strokeDasharray = "1 1"; p.style.strokeDashoffset = String(1 - easeInOut(span(t, 10.8 + i * 0.15, 11.8 + i * 0.15))); });
    reveal(rIn, tIn, IN, easeInOut(span(t, 11.8, 12.9)));
    pose(wIn, IN.at(0).p, 1.08, 0);
    el.dataset.t = t.toFixed(2);
  };

  const reduced = !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const frozen = params.has("storyt") ? Number(params.get("storyt")) : NaN;
  let raf = 0, t0 = 0;
  const loop = (now: number) => {
    if (!t0) t0 = now;
    draw((now - t0) / 1000);
    raf = win!.requestAnimationFrame(loop);
  };
  const start = () => { if (!raf && win?.requestAnimationFrame) { raf = win.requestAnimationFrame(loop); el.dataset.running = "true"; } };
  const stop = () => { if (raf) win?.cancelAnimationFrame(raf); raf = 0; el.dataset.running = "false"; };

  el.dataset.running = "false";
  if (reduced || Number.isFinite(frozen)) {
    draw(Number.isFinite(frozen) ? frozen : STATIC_T);
    el.dataset.static = "true";
  } else {
    draw(0);
    if (!home.hidden) start();
    // The loop runs only while Home shows (no work behind the 3D scene).
    new (win!.MutationObserver)(() => (home.hidden ? stop() : start())).observe(home, { attributes: true, attributeFilter: ["hidden"] });
  }
  return { el, draw, running: () => el.dataset.running === "true", stop };
}
