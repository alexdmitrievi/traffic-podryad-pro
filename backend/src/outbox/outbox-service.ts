/**
 * The durable outbox (docs/ARCHITECTURE.md section 5).
 *
 * A row is work that must not be lost. The claim protocol is what makes that true under
 * concurrency and crashes:
 *
 *   - claim: the earliest available row is locked FOR UPDATE SKIP LOCKED and marked
 *     `running` with a fresh fencing token and a lease. A lease that expired is reclaimable,
 *     and reclaiming preserves the attempt counter — the counter counts logical failures,
 *     not claims;
 *   - complete / fail: both require the row id AND the fencing token the claimant holds.
 *     A mismatch means the lease was lost (another worker reclaimed the row) and the
 *     operation is ignored — the loser can neither delete nor corrupt the new claim;
 *   - fail: attempts increments; the row becomes `dead` when the cap is reached, otherwise
 *     it returns to `pending` with `available_at` in the future — the retry delay.
 *
 * `enqueue` is idempotent by `dedupe_key`: scheduling the same logical work twice produces
 * one row. The key is the enqueuer's responsibility (e.g. "brief:<briefId>").
 *
 * This service is backend machinery, not a product module, so it may talk to Prisma
 * directly. Product modules reach it through the application layer later.
 */

import type { Db } from '../db'
import type { Prisma } from '../generated/prisma/client.ts'

export interface OutboxOptions {
  leaseMs: number
  maxAttempts: number
  retryBaseMs: number
  retryMaxMs: number
}

export const defaultOutboxOptions: OutboxOptions = {
  leaseMs: 30_000,
  maxAttempts: 8,
  retryBaseMs: 1_000,
  retryMaxMs: 600_000,
}

export interface OutboxTaskRow {
  id: string
  taskType: string
  payload: unknown
  attempts: number
  maxAttempts: number
}

export interface ClaimedTask extends OutboxTaskRow {
  fencingToken: string
}

export interface EnqueueInput {
  taskType: string
  payload: unknown
  dedupeKey: string
  availableAt?: Date
}

export interface Outbox {
  enqueue(input: EnqueueInput): Promise<void>
  claimNext(now?: Date): Promise<ClaimedTask | null>
  complete(input: { id: string; fencingToken: string }): Promise<boolean>
  fail(input: { id: string; fencingToken: string; error: string; now?: Date }): Promise<boolean>
}

/**
 * Exponential backoff with full jitter, capped. Pure so the schedule itself is unit-testable.
 */
export function retryDelay(attempt: number, options: OutboxOptions): number {
  const exponent = Math.min(attempt - 1, 20)
  const ceiling = Math.min(options.retryBaseMs * 2 ** exponent, options.retryMaxMs)
  const floor = Math.min(ceiling, options.retryBaseMs)
  return floor + Math.floor(Math.random() * (ceiling - floor + 1))
}

interface ClaimResultRow {
  id: string
  task_type: string
  payload: unknown
  attempts: number
  max_attempts: number
}

export function createOutbox(db: Db, options: OutboxOptions = defaultOutboxOptions): Outbox {
  return {
    async enqueue(input) {
      await db.$executeRaw`
        INSERT INTO task_outbox
          (id, task_type, payload, dedupe_key, status, attempts, max_attempts, available_at, created_at, updated_at)
        VALUES
          (${crypto.randomUUID()}::uuid, ${input.taskType}, ${JSON.stringify(input.payload)}::jsonb,
           ${input.dedupeKey}, 'pending', 0, ${options.maxAttempts}, ${input.availableAt ?? new Date()},
           now(), now())
        ON CONFLICT (dedupe_key) DO NOTHING`
    },

    async claimNext(now = new Date()) {
      const leaseUntil = new Date(now.getTime() + options.leaseMs)
      return db.$transaction(async (tx: Prisma.TransactionClient) => {
        const selected = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM task_outbox
          WHERE available_at <= ${now}
            AND (status = 'pending' OR (status = 'running' AND lease_until <= ${now}))
          ORDER BY created_at ASC, id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`
        const id = selected[0]?.id
        if (!id) return null

        const fencingToken = crypto.randomUUID()
        const rows = await tx.$queryRaw<ClaimResultRow[]>`
          UPDATE task_outbox
          SET status = 'running', lease_until = ${leaseUntil}, fencing_token = ${fencingToken}
          WHERE id = ${id}::uuid
          RETURNING id, task_type, payload, attempts, max_attempts`
        const row = rows[0]
        if (!row) return null

        return {
          id: row.id,
          taskType: row.task_type,
          payload: row.payload,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
          fencingToken,
        }
      })
    },

    async complete({ id, fencingToken }) {
      const rows = await db.$queryRaw<Array<{ id: string }>>`
        DELETE FROM task_outbox
        WHERE id = ${id}::uuid AND fencing_token = ${fencingToken}
        RETURNING id`
      return rows.length === 1
    },

    async fail({ id, fencingToken, error, now = new Date() }) {
      const current = await db.$queryRaw<Array<{ attempts: number }>>`
        SELECT attempts FROM task_outbox WHERE id = ${id}::uuid AND fencing_token = ${fencingToken}`
      const row = current[0]
      if (!row) return false

      const nextAttempt = row.attempts + 1
      const nextAt = new Date(now.getTime() + retryDelay(nextAttempt, options))

      const updated = await db.$queryRaw<Array<{ id: string }>>`
        UPDATE task_outbox
        SET attempts = attempts + 1,
            last_error = ${error},
            status = CASE WHEN attempts + 1 >= max_attempts THEN 'dead'::task_outbox_status
                          ELSE 'pending'::task_outbox_status END,
            available_at = CASE WHEN attempts + 1 >= max_attempts THEN available_at
                                ELSE ${nextAt} END,
            lease_until = NULL,
            fencing_token = NULL
        WHERE id = ${id}::uuid
          AND fencing_token = ${fencingToken}
          AND attempts = ${row.attempts}
        RETURNING id`
      return updated.length === 1
    },
  }
}
