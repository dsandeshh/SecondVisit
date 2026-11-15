// The beacon's sound model, as pure maths (the scheduler in continuous.ts plays exactly what these return, and the
// headless bot navigates by the same cue). Like an aviation localiser: aim, then commit.
//   on axis (|az| <= 5):   a short bright click on each pulse and the pitch raised a semitone
//   near (5 < |az| <= 20): a weaker click, the pitch raised half as much
//   plain (20 < |az| <= 90): the plain pulse
//   behind (|az| > 90):    a 2 kHz low-pass, a 3 dB drop and a slower pulse, so front and back never sound alike
// Distance is carried by the pulse rate, not loudness: 1/s beyond 10 m, 2/s at 5 m, 4/s within 2 m.

export const ON_AXIS_DEG = 5, NEAR_AXIS_DEG = 20, BACK_DEG = 90;
export const BEACON_HZ = 740;
/** On axis: one semitone up (x 1.0595); near: a quarter tone up. */
export const ON_PITCH = 2 ** (1 / 12), NEAR_PITCH = 2 ** (1 / 24);
/** The click: a sine burst well above the pulse (and far above the 160 Hz obstacle tick), 8 ms long. */
export const CLICK_HZ = 3200, CLICK_S = 0.008, ON_CLICK = 0.9, NEAR_CLICK = 0.35;
export const BEHIND_LP_HZ = 2000, OPEN_LP_HZ = 18000, BEHIND_LEVEL = 0.7, BEHIND_RATE = 0.8;

export type Cue = "on" | "near" | "plain" | "behind";
export type CueParams = { cue: Cue; hz: number; click: number; lpHz: number; level: number; rateK: number };

/** The cue for a target at azimuth `az` degrees from straight ahead (+ right). */
export function cueOf(az: number): Cue {
  const a = Math.abs(az);
  if (a <= ON_AXIS_DEG) return "on";
  if (a <= NEAR_AXIS_DEG) return "near";
  return a > BACK_DEG ? "behind" : "plain";
}

/** What one pulse sounds like at azimuth `az`: pitch, click level (0 = none, relative to the pulse), low-pass, level, rate factor. */
export function cueParams(az: number): CueParams {
  const cue = cueOf(az);
  const behind = cue === "behind";
  return {
    cue,
    hz: BEACON_HZ * (cue === "on" ? ON_PITCH : cue === "near" ? NEAR_PITCH : 1),
    click: cue === "on" ? ON_CLICK : cue === "near" ? NEAR_CLICK : 0,
    lpHz: behind ? BEHIND_LP_HZ : OPEN_LP_HZ,
    level: behind ? BEHIND_LEVEL : 1,
    rateK: behind ? BEHIND_RATE : 1,
  };
}

/** What a listener hears of the beacon: the cue and which ear it leans to (the HRTF pan). The bot reads only this. */
export function heard(az: number): { cue: Cue; side: -1 | 0 | 1 } {
  return { cue: cueOf(az), side: az > 0.5 ? 1 : az < -0.5 ? -1 : 0 };
}

/** Pulses per second at `d` metres: 1 beyond 10 m, 2 at 5 m, 4 within 2 m, linear between those knots. */
export function pulseRate(d: number): number {
  if (!Number.isFinite(d) || d >= 10) return 1;
  if (d <= 2) return 4;
  return d >= 5 ? 1 + (10 - d) / 5 : 2 + (5 - d) * 2 / 3;
}

// ---- the continuous hum (human decision 15 Nov 06:30, replaces the pulse in Explore) ----------------------------------
// One voice started once and kept alive: three nearly pure partials (a tonal G3 chord tone) plus a faint band-limited
// sheen of noise, through the HRTF panner at the corner of the path aimed at. Distance is the amplitude wobble rate;
// aim is brightness (low-pass) and steadiness.
/** Partials (Hz), their levels and detune (cents, at most 2: clean, not chorused). */
export const HUM_PARTIALS: { hz: number; level: number; cents: number }[] = [
  { hz: 196, level: 1, cents: -1 }, { hz: 294, level: 0.35, cents: 1.5 }, { hz: 392, level: 0.18, cents: -1 },
];
/** Band-limited noise: a band-pass centred at 4 kHz (Q 1.5, roughly 3-5 kHz), at 5 % of the hum's level: a faint sheen. */
export const HUM_NOISE_HZ = 4000, HUM_NOISE_Q = 1.5, HUM_NOISE_LEVEL = 0.05;
/** Brightness: off axis (> 20 deg) 900 Hz, on axis 7 kHz (swept log-linearly 20 -> 5 deg), behind 1 kHz. */
export const HUM_DARK_HZ = 900, HUM_BRIGHT_HZ = 7000, HUM_BEHIND_HZ = 1000;
/** Wobble depth (0..1 of the level): 45 % off axis, 15 % at 5 deg, 10 % on axis (nearly steady). */
export const WOBBLE_DEPTH = 0.45, WOBBLE_NEAR_DEPTH = 0.15, WOBBLE_ON_DEPTH = 0.1;
/** Behind: about -4 dB, the wobble 25 % slower. */
export const HUM_BEHIND_LEVEL = 10 ** (-4 / 20), HUM_BEHIND_RATE = 0.75;
/** On axis: one faint click per second. */
export const HUM_CLICK_PER_S = 1, HUM_CLICK_LEVEL = 0.35;
/** Every parameter ramps with this time constant (setTargetAtTime: ~80 ms to settle); the source glides over ~250 ms. */
export const HUM_RAMP_TAU = 0.08 / 3, HUM_GLIDE_TAU = 0.25 / 3;

/** Wobble (AM) rate in Hz at `d` metres: 1.5 beyond 10 m, 3 at 5 m, 6 within 2 m, linear between those knots. */
export function wobbleHz(d: number): number {
  if (!Number.isFinite(d) || d >= 10) return 1.5;
  if (d <= 2) return 6;
  return d >= 5 ? 1.5 + (10 - d) * 1.5 / 5 : 3 + (5 - d);
}

export type HumParams = { cue: Cue; lpHz: number; depth: number; rateHz: number; level: number; click: boolean };

/** The hum at azimuth `az` (deg, + right) with `d` metres to go: low-pass, wobble depth and rate, level, the on axis click. */
export function humParams(az: number, d: number): HumParams {
  const cue = cueOf(az), a = Math.abs(az), rate = wobbleHz(d);
  if (cue === "behind") return { cue, lpHz: HUM_BEHIND_HZ, depth: WOBBLE_DEPTH, rateHz: rate * HUM_BEHIND_RATE, level: HUM_BEHIND_LEVEL, click: false };
  if (cue === "plain") return { cue, lpHz: HUM_DARK_HZ, depth: WOBBLE_DEPTH, rateHz: rate, level: 1, click: false };
  if (cue === "on") return { cue, lpHz: HUM_BRIGHT_HZ, depth: WOBBLE_ON_DEPTH, rateHz: rate, level: 1, click: true };
  const k = (NEAR_AXIS_DEG - a) / (NEAR_AXIS_DEG - ON_AXIS_DEG);   // 0 at 20 deg .. 1 at 5 deg
  return { cue, lpHz: HUM_DARK_HZ * (HUM_BRIGHT_HZ / HUM_DARK_HZ) ** k, depth: WOBBLE_DEPTH + (WOBBLE_NEAR_DEPTH - WOBBLE_DEPTH) * k,
    rateHz: rate, level: 1, click: false };
}
