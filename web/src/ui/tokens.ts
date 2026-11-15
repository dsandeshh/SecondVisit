export const token = (name: string, el: Element = document.documentElement): string =>
  getComputedStyle(el).getPropertyValue(name).trim();

export const reducedMotion = (): boolean =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export type PlanPalette = ReturnType<typeof planPalette>;
export function planPalette() {
  const t = (n: string) => token(n);
  return {
    wall: t("--d-wall"), glass: t("--d-glass"), obstacle: t("--d-obstacle"),
    route: t("--d-route"), casing: t("--d-route-casing"), before: t("--d-before"),
    stairsA: t("--d-stairs-a"), stairsB: t("--d-stairs-b"),
    traveller: t("--d-traveller"), travellerRing: t("--d-traveller-ring"), caneFree: t("--d-cane-free"),
    heat: [t("--heat-1"), t("--heat-2"), t("--heat-3"), t("--heat-4")],
    heatAlpha: Number(t("--heat-alpha")), planOpacity: Number(t("--d-plan-image-opacity")),
    paper: t("--c-surface"), ink: t("--c-ink"), ink2: t("--c-ink-2"),
  };
}

/** Re read the palette when theme, contrast or motion preferences change. */
export function onPrefsChange(fn: () => void): void {
  for (const q of ["(prefers-color-scheme: dark)", "(prefers-contrast: more)", "(prefers-reduced-motion: reduce)"])
    matchMedia(q).addEventListener("change", fn);
}

/** Diagonal hatch for stairs and "simulated" areas on canvas. */
export function hatch(ctx: CanvasRenderingContext2D, a: string, b: string, size = 12): CanvasPattern {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = b; g.fillRect(0, 0, size, size);
  g.strokeStyle = a; g.lineWidth = size / 3;
  g.beginPath(); g.moveTo(-size, size); g.lineTo(size, -size); g.moveTo(0, 2 * size); g.lineTo(2 * size, 0); g.stroke();
  return ctx.createPattern(c, "repeat")!;
}

/** Size a canvas for crisp lines on any display. Call on resize. */
export function fitCanvas(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
  cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
  const ctx = cv.getContext("2d")!; ctx.setTransform(d, 0, 0, d, 0, 0); return ctx;
}
