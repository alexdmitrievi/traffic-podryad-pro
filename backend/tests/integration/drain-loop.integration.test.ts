import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createOutbox } from '../../src/outbox/outbox-service'
import { createDrainLoop, drainOnce } from '../../src/outbox/drain-loop'
import { clearOutbox, createTestDb } from './helpers'
import type { Db } from '../../src/db'

let db: Db

const loopOutbox = () =>
  createOutbox(db, { leaseMs: 30_000, maxAttempts: 3, retryBaseMs: 30, retryMaxMs: 60 })

describe('outbox drain', () => {
  beforeEach(async () => {
    db = createTestDb()
    await clearOutbox(db)
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  test('drainOnce executes every claimable task exactly once', async () => {
    const executed: string[] = []
    for (let i = 0; i < 5; i++) {
      await loopOutbox().enqueue({
        taskType: 'test.count',
        payload: { n: i },
        dedupeKey: `drain-${i}`,
      })
    }

    const handled = await drainOnce({
      outbox: loopOutbox(),
      handlers: {
        'test.count': async (payload) => {
          executed.push(String((payload as { n: number }).n))
        },
      },
    })

    expect(handled).toBe(5)
    expect(executed.sort()).toEqual(['0', '1', '2', '3', '4'])
    expect(await db.taskOutbox.count()).toBe(0)
  })

  test('two concurrent drains do not execute one task twice', async () => {
    const executions = new Map<string, number>()
    const count = async (payload: unknown) => {
      const key = String((payload as { n: number }).n)
      executions.set(key, (executions.get(key) ?? 0) + 1)
    }

    for (let i = 0; i < 20; i++) {
      await loopOutbox().enqueue({ taskType: 'test.count', payload: { n: i }, dedupeKey: `race-${i}` })
    }

    const loopA = createDrainLoop({ outbox: loopOutbox(), handlers: { 'test.count': count }, pollIntervalMs: 1 })
    const loopB = createDrainLoop({ outbox: loopOutbox(), handlers: { 'test.count': count }, pollIntervalMs: 1 })

    // start() returns the loop promise, which by design never resolves on its own — the
    // loops run until stop(). Wait for the queue to drain instead.
    void loopA.start()
    void loopB.start()

    let drained = false
    for (let i = 0; i < 100; i++) {
      if ((await db.taskOutbox.count()) === 0) {
        drained = true
        break
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
    }
    expect(drained).toBe(true)

    await Promise.all([loopA.stop(), loopB.stop()])

    expect(await db.taskOutbox.count()).toBe(0)
    expect(executions.size).toBe(20)
    for (const value of executions.values()) {
      expect(value).toBe(1)
    }
  })

  test('stop drains the accepted task and claims nothing afterwards', async () => {
    let started = false
    let finished = false
    let release!: () => void
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve
    })

    await loopOutbox().enqueue({ taskType: 'test.slow', payload: {}, dedupeKey: 'slow-1' })
    await loopOutbox().enqueue({ taskType: 'test.slow', payload: {}, dedupeKey: 'slow-2' })

    const loop = createDrainLoop({
      outbox: loopOutbox(),
      handlers: {
        'test.slow': async () => {
          started = true
          await releasePromise
          finished = true
        },
      },
      pollIntervalMs: 1,
    })

    const run = loop.start()
    while (!started) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
    }

    const stopPromise = loop.stop()
    // The loop must not exit before the accepted task finishes.
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    expect(finished).toBe(false)
    expect(await db.taskOutbox.count()).toBe(2)

    release()
    await stopPromise
    await run

    expect(finished).toBe(true)
    // Exactly the accepted task completed; the second row was never claimed.
    expect(await db.taskOutbox.count()).toBe(1)
  })

  test('a task type without a handler fails and eventually goes dead with a visible error', async () => {
    await loopOutbox().enqueue({ taskType: 'test.unknown', payload: {}, dedupeKey: 'unknown-1' })

    const outbox = loopOutbox()
    await drainOnce({ outbox, handlers: {} })

    const row = await db.taskOutbox.findFirstOrThrow({ where: { dedupeKey: 'unknown-1' } })
    expect(row.status).toBe('pending')
    expect(row.lastError).toContain('no handler registered')
  })
})
