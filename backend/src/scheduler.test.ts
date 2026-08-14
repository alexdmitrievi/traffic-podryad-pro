import { describe, expect, test } from 'bun:test'
import { createScheduler, isDue } from './scheduler'

describe('isDue', () => {
  test('a job that never ran is due', () => {
    expect(isDue(null, 1, 1_000)).toBe(true)
  })

  test('a job is due once its interval elapsed', () => {
    expect(isDue(0, 1, 60_000)).toBe(true)
    expect(isDue(0, 1, 59_999)).toBe(false)
    expect(isDue(0, 5, 300_000)).toBe(true)
    expect(isDue(0, 5, 299_999)).toBe(false)
  })
})

describe('scheduler loop', () => {
  test('runs each job once per due window and stops cleanly', async () => {
    let calls = 0
    const scheduler = createScheduler({
      jobs: [{ name: 'outbox.drain', everyMinutes: 1 }],
      handlers: {
        'outbox.drain': async () => {
          calls += 1
        },
      },
      tickMs: 10,
    })

    const loop = scheduler.start()
    await new Promise<void>((resolve) => setTimeout(resolve, 60))
    await scheduler.stop()
    await loop

    expect(calls).toBeGreaterThanOrEqual(1)

    const afterStop = calls
    await new Promise<void>((resolve) => setTimeout(resolve, 30))
    expect(calls).toBe(afterStop)
  })

  test('a failing handler does not stop the loop and is retried next tick', async () => {
    let calls = 0
    const errors: string[] = []
    const scheduler = createScheduler({
      jobs: [{ name: 'outbox.drain', everyMinutes: 1 }],
      handlers: {
        'outbox.drain': async () => {
          calls += 1
          if (calls === 1) throw new Error('boom')
        },
      },
      logger: { info() {}, error: (message) => errors.push(message) },
      tickMs: 10,
    })

    const loop = scheduler.start()
    await new Promise<void>((resolve) => setTimeout(resolve, 60))
    await scheduler.stop()
    await loop

    expect(calls).toBeGreaterThanOrEqual(2)
    expect(errors.some((message) => message.includes('boom'))).toBe(true)
  })
})
