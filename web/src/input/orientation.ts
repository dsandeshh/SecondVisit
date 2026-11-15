// Device orientation: relative yaw turns the body, gamma sweeps the cane (agent3 1.4). Never the compass.
import { wrap180, wrap360 } from "../world";

export type Motion = "granted" | "denied" | "unavailable";
export type InputMode = "motion" | "touch" | "keys";

/** Must be called synchronously inside the Start click: iOS needs transient activation. */
export function requestMotion(win: Window = window): Promise<"granted" | "denied" | "unavailable"> {
  const DOE = (win as any).DeviceOrientationEvent;
  if (!DOE || !win.isSecureContext) return Promise.resolve("unavailable");
  if (typeof DOE.requestPermission === "function") {
    try {
      return Promise.resolve(DOE.requestPermission())
        .then((r: string) => (r === "granted" ? "granted" : "denied"), () => "denied" as const);
    } catch { return Promise.resolve("denied"); }
  }
  return Promise.resolve("granted");
}

/** Motion counts only after a real event with a non null alpha arrives within ms. */
export function firstRealOrientation(ms: number, win: Window = window): Promise<Motion> {
  return new Promise(resolve => {
    const on = (e: Event) => {
      if ((e as DeviceOrientationEvent).alpha == null) return;
      done("granted");
    };
    const timer = setTimeout(() => done("unavailable"), ms);
    const done = (m: Motion) => { clearTimeout(timer); win.removeEventListener("deviceorientation", on); resolve(m); };
    win.addEventListener("deviceorientation", on);
  });
}

export function modeFor(m: Motion, coarse = isCoarse()): InputMode {
  if (m === "granted") return "motion";
  if (m === "denied") return "touch";
  return coarse ? "touch" : "keys";
}

export function isCoarse(): boolean {
  try { return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches; } catch { return false; }
}

/** Low passed (one pole, 0.2) relative heading and cane angle from deviceorientation. */
export class MotionInput {
  private alpha0: number | null = null;
  private alpha: number | null = null;
  private base = 0;
  private yaw = 0;
  private cane = 0;
  private handler = (e: Event) => this.onEvent(e as DeviceOrientationEvent);

  constructor(private onHeading: (h: number) => void, private onCane: (deg: number) => void,
    private win: Window = window) {}

  attach(baseHeading: number): void {
    this.base = baseHeading;
    this.win.addEventListener("deviceorientation", this.handler);
  }
  detach(): void { this.win.removeEventListener("deviceorientation", this.handler); }

  /** Recentre: the way the phone points now becomes the traveller's current heading. */
  recentre(heading: number): void { this.base = heading; this.alpha0 = this.alpha; this.yaw = 0; }

  onEvent(e: { alpha: number | null; gamma: number | null }): void {
    if (e.alpha == null || !Number.isFinite(e.alpha)) return;
    this.alpha = e.alpha;
    if (this.alpha0 === null) this.alpha0 = e.alpha;
    // alpha grows counter clockwise; our heading is clockwise
    const target = wrap180(this.alpha0 - e.alpha);
    this.yaw += 0.2 * wrap180(target - this.yaw);
    this.onHeading(wrap360(this.base + this.yaw));
    if (e.gamma != null && Number.isFinite(e.gamma)) {
      this.cane += 0.2 * (Math.max(-50, Math.min(50, e.gamma)) - this.cane);
      this.onCane(this.cane);
    }
  }
}
