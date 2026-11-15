// The sound ring compass: a small circle, "ahead" at the top. Every sound and spoken line that has a place flashes a dot
// at its true direction (same bus, same numbers as the headphones and the caption). Draws only; never changes audio.
import { polar, type Cue, type CueBus } from "../events";

type Dot = { az: number; t0: number; r: number; hot: boolean };
const LIFE_MS = 1600;

export function mountRing(cv: HTMLCanvasElement, bus: CueBus, now: () => number = () => performance.now()): () => void {
  const dots: Dot[] = [];
  let raf = 0;
  const off = bus.subscribe((c: Cue) => {
    if ((c.kind !== "say" && c.kind !== "sound") || !c.at) return;
    const p = polar(bus.listener, c.at);
    dots.push({ az: p.az, t0: now(), r: Math.min(1, p.distM / 8), hot: c.bus === "safety" });
    if (dots.length > 8) dots.shift();
    if (!raf) raf = requestAnimationFrame(draw);
  });
  const css = (n: string, f: string) => getComputedStyle(cv).getPropertyValue(n).trim() || f;
  function draw() {
    raf = 0;
    const g = cv.getContext("2d"); if (!g) return;
    const W = cv.width, c = W / 2, R = c - 10, t = now();
    g.clearRect(0, 0, W, W);
    g.lineWidth = 2; g.strokeStyle = css("--c-ink-2", "#6E6E73"); g.globalAlpha = 0.55;
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(c, c - R - 6); g.lineTo(c, c - R + 8); g.stroke();   // ahead
    g.globalAlpha = 1;
    g.fillStyle = css("--c-mark", "#FFC629"); g.strokeStyle = css("--c-ink", "#1D1D1F");
    g.beginPath(); g.arc(c, c, 5, 0, Math.PI * 2); g.fill(); g.stroke();   // you
    for (let i = dots.length - 1; i >= 0; i--) {
      const d = dots[i], k = (t - d.t0) / LIFE_MS;
      if (k >= 1) { dots.splice(i, 1); continue; }
      const a = d.az * Math.PI / 180, rr = R * (0.55 + 0.45 * d.r);
      g.globalAlpha = 1 - k;
      g.fillStyle = d.hot ? css("--d-obstacle", "#C45A00") : css("--d-route", "#2160A8");
      g.beginPath(); g.arc(c + Math.sin(a) * rr, c - Math.cos(a) * rr, 9 + 6 * k, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    if (dots.length) raf = requestAnimationFrame(draw);
  }
  draw();
  return () => { off(); if (raf) cancelAnimationFrame(raf); };
}
