import { describe, expect, test } from 'bun:test'
import { runInBackground, waitForBackgroundTasks } from './background-tasks'

describe('background tasks', () => {
  test('a started task settles within the wait window', async () => {
    let done = false
    runInBackground(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 30))
      done = true
    })

    await waitForBackgroundTasks(1_000)
    expect(done).toBe(true)
  })

  test('a failing task reports to the handler instead of throwing unhandled', async () => {
    const errors: unknown[] = []
    runInBackground(
      async () => {
        throw new Error('expected failure')
      },
      (error) => errors.push(error),
    )

    await waitForBackgroundTasks(1_000)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
  })

  test('waitForBackgroundTasks respects the deadline', async () => {
    runInBackground(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 300))
    })

    const started = Date.now()
    await waitForBackgroundTasks(20)
    expect(Date.now() - started).toBeLessThan(250)

    // Drain the still-running task so the next test starts with an empty pool.
    await waitForBackgroundTasks(1_000)
  })

  test('an empty wait resolves immediately', async () => {
    const started = Date.now()
    await waitForBackgroundTasks(500)
    expect(Date.now() - started).toBeLessThan(100)
  })
})
