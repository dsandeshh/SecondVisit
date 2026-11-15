import { describe, expect, it } from 'vitest'
import cases from '../../data/fixtures/clock_cases.json'
import { clockHour } from './clock'

describe('clockHour', () => {
  for (const c of cases.cases) it(`${c.rel_deg} -> ${c.hour}`, () => expect(clockHour(c.rel_deg)).toBe(c.hour))
})
