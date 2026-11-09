import { describe, it, expect } from 'vitest'
import { computeBackoffMs, baseBackoffMs, MAX_ATTEMPTS, RETRY_SCHEDULE_MINUTES } from '../backoff.js'

describe('backoff', () => {
  it('schedule matches GitHub retry cadence', () => {
    expect(RETRY_SCHEDULE_MINUTES[0]).toBe(1)
    expect(RETRY_SCHEDULE_MINUTES[1]).toBe(5)
    expect(RETRY_SCHEDULE_MINUTES[8]).toBe(640)
    expect(RETRY_SCHEDULE_MINUTES.slice(9)).toEqual(Array(21).fill(60))
    expect(RETRY_SCHEDULE_MINUTES.length + 1).toBeGreaterThanOrEqual(MAX_ATTEMPTS)
  })

  it('baseBackoffMs returns correct window for first 3 attempts', () => {
    expect(baseBackoffMs(1)).toBe(60_000) // 1 min
    expect(baseBackoffMs(2)).toBe(5 * 60_000) // 5 min
    expect(baseBackoffMs(3)).toBe(10 * 60_000) // 10 min
  })

  it('baseBackoffMs caps at 60min (hourly) for high attempts', () => {
    expect(baseBackoffMs(30)).toBe(60 * 60_000)
  })

  it('computeBackoffMs returns a value in [0, base)', () => {
    for (let attempt = 1; attempt <= 30; attempt++) {
      for (let i = 0; i < 50; i++) {
        const delay = computeBackoffMs(attempt)
        expect(delay).toBeGreaterThanOrEqual(0)
        expect(delay).toBeLessThan(baseBackoffMs(attempt))
      }
    }
  })

  it('computeBackoffMs has reasonable distribution (visual sanity)', () => {
    const samples = Array.from({ length: 1000 }, () => computeBackoffMs(2))
    const min = Math.min(...samples)
    const max = Math.max(...samples)
    const base = baseBackoffMs(2)
    expect(min).toBeLessThan(base / 2)
    expect(max).toBeGreaterThan(base / 2)
  })
})
