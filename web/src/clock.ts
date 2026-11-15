/** Mirror of engine/dr/instructions.py clock_hour. Half-to-even rounding like Python's round. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d < 0.5) return f
  if (d > 0.5) return f + 1
  return f % 2 === 0 ? f : f + 1
}

export function clockHour(relDeg: number): number {
  const d = (((relDeg + 180) % 360) + 360) % 360 - 180
  const w = d === -180 ? 180 : d
  const h = ((roundHalfEven(w / 30) % 12) + 12) % 12
  return h === 0 ? 12 : h
}
