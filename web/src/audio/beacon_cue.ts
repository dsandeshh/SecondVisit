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
