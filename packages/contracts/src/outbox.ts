import { z } from 'zod'

/**
 * Durable outbox machinery (docs/ARCHITECTURE.md section 5).
 *
 * The outbox is backend infrastructure, not an API payload. The schema lives in the
 * contracts anyway because the repository rule is that every PostgreSQL enum has a Zod
 * counterpart here and the schema tests enforce the parity in both directions.
 */

export const taskOutboxStatusSchema = z.enum(['pending', 'running', 'dead'])

export type TaskOutboxStatus = z.infer<typeof taskOutboxStatusSchema>
