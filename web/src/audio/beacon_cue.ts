// The beacon's sound model, as pure maths (the scheduler in continuous.ts plays exactly what these return, and the
// headless bot navigates by the same cue). One continuous hum (partials 220/440/660/880/1320 Hz slightly detuned plus a
// little band-limited noise near 2.6 kHz), never a sine and never restarted. Like an aviation localiser: aim, then commit.
//   Distance = the wobble (amplitude modulation) rate: 1.5 Hz beyond 10 m, 3 Hz at 5 m, 6 Hz within 2 m; level ~constant.
//   Aim = brightness: beyond 20 degrees off a 1.2 kHz low-pass and the full 50% wobble; from 20 to 5 degrees the low-pass
//   sweeps up to 6 kHz and the wobble depth falls to 15%; within 5 degrees the brightest, nearly steady, and one faint
//   click a second.
//   Behind (beyond 90 degrees): a 1 kHz low-pass, 4 dB down and the wobble 25% slower, so front and back never sound alike.

export const ON_AXIS_DEG = 5, NEAR_AXIS_DEG = 20, BACK_DEG = 90;
export const HUM_PARTIALS = [220, 440, 660, 880, 1320] as const;
/** Each partial's detune in cents (slightly off, so the hum beats a little and is never a pure tone) and its weight. */
export const HUM_DETUNE = [0, 4, -3, 5, -4] as const, HUM_WEIGHTS = [1, 0.6, 0.4, 0.3, 0.2] as const;
export const NOISE_HZ = 2600, NOISE_MIX = 0.2;
export const DULL_LP_HZ = 1200, SHARP_LP_HZ = 6000, ON_LP_HZ = 8000, BEHIND_LP_HZ = 1000;
export const FULL_DEPTH = 0.5, NEAR_DEPTH = 0.15, ON_DEPTH = 0.06;
export const BEHIND_DB = -4, BEHIND_LEVEL = 10 ** (BEHIND_DB / 20), BEHIND_RATE = 0.75;
/** Every hum parameter glides to its new value over about this long (no zipper, no click). */
export const RAMP_S = 0.08;
/** The on axis click: a short sine burst well above the hum, once a second, faint. */
export const CLICK_HZ = 3200, CLICK_S = 0.008, CLICK_EVERY_S = 1, CLICK_LEVEL = 0.3;

export type Cue = "on" | "near" | "plain" | "behind";
export type HumParams = { cue: Cue; lpHz: number; rateHz: number; depth: number; level: number; click: boolean };

/** The cue (aim band) for a target at azimuth `az` degrees from straight ahead (+ right). */
export function cueOf(az: number): Cue {
  const a = Math.abs(az);
  if (a <= ON_AXIS_DEG) return "on";
  if (a <= NEAR_AXIS_DEG) return "near";
  return a > BACK_DEG ? "behind" : "plain";
}

/** Wobble cycles per second at `d` metres: 1.5 beyond 10 m, 3 at 5 m, 6 within 2 m, linear between those knots. */
export function wobbleRate(d: number): number {
  if (!Number.isFinite(d) || d >= 10) return 1.5;
  if (d <= 2) return 6;
  return d >= 5 ? 1.5 + (10 - d) / 5 * 1.5 : 3 + (5 - d) / 3 * 3;
}

/** The hum at azimuth `az` with `d` metres to go: low-pass, wobble rate and depth, level (x BEACON_GAIN), on axis click. */
export function humParams(az: number, d: number): HumParams {
  const a = Math.abs(az), cue = cueOf(az), rate = wobbleRate(d);
  if (cue === "behind") return { cue, lpHz: BEHIND_LP_HZ, rateHz: rate * BEHIND_RATE, depth: FULL_DEPTH, level: BEHIND_LEVEL, click: false };
  if (cue === "on") return { cue, lpHz: ON_LP_HZ, rateHz: rate, depth: ON_DEPTH, level: 1, click: true };
  if (cue === "plain") return { cue, lpHz: DULL_LP_HZ, rateHz: rate, depth: FULL_DEPTH, level: 1, click: false };
  const f = (NEAR_AXIS_DEG - a) / (NEAR_AXIS_DEG - ON_AXIS_DEG);   // 0 at 20 degrees, 1 at 5
  return { cue, lpHz: DULL_LP_HZ * (SHARP_LP_HZ / DULL_LP_HZ) ** f, rateHz: rate, depth: FULL_DEPTH + (NEAR_DEPTH - FULL_DEPTH) * f, level: 1, click: false };
}

/** What a listener hears of the beacon: the aim band and which ear it leans to (the HRTF pan). The bot reads only this. */
export function heard(az: number): { cue: Cue; side: -1 | 0 | 1 } {
  return { cue: cueOf(az), side: az > 0.5 ? 1 : az < -0.5 ? -1 : 0 };
}
