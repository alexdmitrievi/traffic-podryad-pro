import { describe, expect, test } from 'bun:test'
import { defaultOutboxOptions, retryDelay } from './outbox-service'

describe('retryDelay', () => {
  test('the first retry is the base delay', () => {
    const options = { ...defaultOutboxOptions, retryBaseMs: 1_000, retryMaxMs: 600_000 }
    const delay = retryDelay(1, options)
    expect(delay).toBeGreaterThanOrEqual(1_000)
    expect(delay).toBeLessThanOrEqual(2_000)
  })

  test('delays grow with the attempt count', () => {
    const options = { ...defaultOutboxOptions, retryBaseMs: 100, retryMaxMs: 1_000_000 }
    const first = retryDelay(1, options)
    const third = retryDelay(3, options)

    expect(third).toBeGreaterThanOrEqual(first)
    expect(third).toBeLessThanOrEqual(800)
  })

  test('the cap is respected however large the attempt count', () => {
    const options = { ...defaultOutboxOptions, retryBaseMs: 1_000, retryMaxMs: 60_000 }
    for (const attempt of [8, 20, 200]) {
      const delay = retryDelay(attempt, options)
      expect(delay).toBeGreaterThanOrEqual(1_000)
      expect(delay).toBeLessThanOrEqual(60_000)
    }
  })
})
