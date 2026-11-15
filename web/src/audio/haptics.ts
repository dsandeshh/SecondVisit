// Vibration on Android Chrome; iOS has none, so always guard (agent3 1.5).
export const PULSE = { contact: 25, landmark: 60, bump: 150 } as const;

export function pulse(ms: number): void {
  const n = globalThis.navigator as Navigator | undefined;
  if (!n || !("vibrate" in n) || typeof n.vibrate !== "function") return;
  try { n.vibrate(Math.max(25, Math.round(ms))); } catch { /* blocked before a gesture: fine */ }
}
