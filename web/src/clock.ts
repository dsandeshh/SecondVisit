/** Mirror of engine/dr/instructions.py clock_hour. rel_deg wrapped to (-180, 180], 0 shown as 12. */
export function clockHour(relDeg: number): number {
  const d = (((relDeg + 180) % 360) + 360) % 360 - 180
  const w = d === -180 ? 180 : d
  const h = ((Math.round(w / 30) % 12) + 12) % 12
  return h === 0 ? 12 : h
}
