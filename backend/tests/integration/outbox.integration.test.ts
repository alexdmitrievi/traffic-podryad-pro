import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createOutbox } from '../../src/outbox/outbox-service'
import type { OutboxOptions } from '../../src/outbox/outbox-service'
import { clearOutbox, createTestDb } from './helpers'
import type { Db } from '../../src/db'

const fastOptions: OutboxOptions = {
  leaseMs: 500,
  maxAttempts: 3,
  retryBaseMs: 30,
  retryMaxMs: 120,
}

let db: Db

describe('outbox', () => {
  beforeEach(async () => {
    db = createTestDb()
    await clearOutbox(db)
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  const outbox = () => createOutbox(db, fastOptions)

  test('enqueue inserts a pending task and claim marks it running with a fencing token', async () => {
    await outbox().enqueue({ taskType: 'test.noop', payload: { hello: 1 }, dedupeKey: 'k1' })

    const claimed = await outbox().claimNext()

    expect(claimed).not.toBeNull()
    expect(claimed?.taskType).toBe('test.noop')
    expect(claimed?.payload).toEqual({ hello: 1 })
    expect(claimed?.attempts).toBe(0)
    expect(claimed?.fencingToken).toBeTruthy()

    const task = claimed as NonNullable<typeof claimed>
    const row = await db.taskOutbox.findFirstOrThrow({ where: { id: task.id } })
    expect(row.status).toBe('running')
    expect(row.fencingToken).toBe(task.fencingToken)
    expect(row.leaseUntil).not.toBeNull()
  })

  test('enqueue is idempotent by dedupe key', async () => {
    await outbox().enqueue({ taskType: 'test.noop', payload: {}, dedupeKey: 'k2' })
    await outbox().enqueue({ taskType: 'test.noop', payload: {}, dedupeKey: 'k2' })

    expect(await db.taskOutbox.count()).toBe(1)
  })

  test('complete deletes the row and requires the fencing token', async () => {
    await outbox().enqueue({ taskType: 'test.noop', payload: {}, dedupeKey: 'k3' })
    const claimed = await outbox().claimNext()
    expect(claimed).not.toBeNull()

    const stolen = await outbox().complete({ id: claimed!.id, fencingToken: 'wrong-token' })
    expect(stolen).toBe(false)
    expect(await db.taskOutbox.count()).toBe(1)

    const completed = await outbox().complete({
      id: claimed!.id,
      fencingToken: claimed!.fencingToken,
    })
    expect(completed).toBe(true)
    expect(await db.taskOutbox.count()).toBe(0)
  })

  test('fail schedules a delayed retry and preserves the attempt counter on reclaim', async () => {
    await outbox().enqueue({ taskType: 'test.noop', payload: {}, dedupeKey: 'k4' })
    const claimed = await outbox().claimNext()
    expect(claimed).not.toBeNull()

    const beforeFail = Date.now()
    const failed = await outbox().fail({
      id: claimed!.id,
      fencingToken: claimed!.fencingToken,
      error: 'boom',
    })
    expect(failed).toBe(true)

    const row = await db.taskOutbox.findFirstOrThrow({ where: { id: claimed!.id } })
    expect(row.attempts).toBe(1)
    expect(row.status).toBe('pending')
    expect(row.lastError).toBe('boom')
    expect(row.fencingToken).toBeNull()
    // The retry moment lies strictly in the future, and no clock reading taken after the
    // fail call can dispute that: it was scheduled relative to that call's own "now".
    expect(row.availableAt.getTime()).toBeGreaterThan(beforeFail)

    // Before the retry window the task is not claimable: asking with the pre-fail clock
    // makes the check deterministic regardless of how long the assertions above took.
    expect(await outbox().claimNext(new Date(beforeFail))).toBeNull()

    // …after it the task is reclaimable, with the attempt counter preserved.
    const reclaimed = await outbox().claimNext(
      new Date(row.availableAt.getTime() + fastOptions.leaseMs + 1_000),
    )
    expect(reclaimed?.id).toBe(claimed!.id)
    expect(reclaimed?.attempts).toBe(1)
  })

  test('fail with a foreign token is ignored', async () => {
    await outbox().enqueue({ taskType: 'test.noop', payload: {}, dedupeKey: 'k5' })
    const claimed = await outbox().claimNext()

    const failed = await outbox().fail({
      id: claimed!.id,
      fencingToken: 'wrong-token',
      error: 'boom',
    })
    expect(failed).toBe(false)

    const row = await db.taskOutbox.findFirstOrThrow({ where: { id: claimed!.id } })
    expect(row.attempts).toBe(0)
    expect(row.status).toBe('running')
  })

  test('fail drives the row to dead once the attempt cap is reached', async () => {
    await outbox().enqueue({ taskType: 'test.noop', payload: {}, dedupeKey: 'k6' })

    for (let attempt = 0; attempt < fastOptions.maxAttempts; attempt++) {
      const claimed = await outbox().claimNext(new Date(Date.now() + fastOptions.retryMaxMs * 100))
      expect(claimed).not.toBeNull()
      await outbox().fail({ id: claimed!.id, fencingToken: claimed!.fencingToken, error: 'boom' })
    }

    const row = await db.taskOutbox.findFirstOrThrow({ where: { dedupeKey: 'k6' } })
    expect(row.status).toBe('dead')
    expect(row.attempts).toBe(fastOptions.maxAttempts)

    expect(await outbox().claimNext(new Date(Date.now() + fastOptions.retryMaxMs * 100))).toBeNull()
  })

  test('an expired lease is reclaimable without losing the attempt counter', async () => {
    await outbox().enqueue({ taskType: 'test.noop', payload: {}, dedupeKey: 'k7' })
    const first = await outbox().claimNext()
    expect(first).not.toBeNull()

    // Simulate the worker crashing: the lease expires and a different worker reclaims.
    const second = await outbox().claimNext(new Date(Date.now() + fastOptions.leaseMs + 100))

    expect(second?.id).toBe(first!.id)
    expect(second?.fencingToken).not.toBe(first!.fencingToken)
    expect(second?.attempts).toBe(0)

    // The stale token can no longer complete or fail the row.
    expect(await outbox().complete({ id: first!.id, fencingToken: first!.fencingToken })).toBe(false)
    expect(await outbox().fail({ id: first!.id, fencingToken: first!.fencingToken, error: 'x' })).toBe(false)
  })

  test('two workers cannot claim the same task', async () => {
    await outbox().enqueue({ taskType: 'test.noop', payload: {}, dedupeKey: 'k8' })

    const secondDb = createTestDb()
    const secondOutbox = createOutbox(secondDb, fastOptions)
    try {
      const [left, right] = await Promise.all([outbox().claimNext(), secondOutbox.claimNext()])

      expect([left, right].filter((claimed) => claimed !== null)).toHaveLength(1)
    } finally {
      await secondDb.$disconnect()
    }
  })
})
