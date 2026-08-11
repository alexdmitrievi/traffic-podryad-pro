import { z } from 'zod'
import {
  idSchema,
  isoDateTimeSchema,
  localeSchema,
  mediumTextSchema,
  shortTextSchema,
  workspaceIdSchema,
} from './common'

/**
 * Service requests: the front door of the platform.
 *
 * Every piece of work enters here. Four service lines exist in the model, but only
 * `seo_content` has delivery in the MVP. See docs/SERVICE_REQUESTS.md.
 */

export const serviceLineSchema = z.enum([
  'seo_content',
  'b2b_outreach',
  'telegram_marketing',
  'complex_package',
])

/**
 * `planned_awaiting_capability` is terminal and intentional, not an error state. It means the
 * plan is finished and approved and the product deliberately has no way to execute it. It
 * exists so "we do not do this by decision" is distinguishable from "this request is stuck
 * and nobody noticed".
 */
export const serviceRequestStatusSchema = z.enum([
  'draft',
  'submitted',
  'triage',
  'accepted',
  'rejected',
  'planning',
  'plan_approved',
  'in_delivery',
  'delivered',
  'planned_awaiting_capability',
  'partially_delivered',
  'on_hold',
  'cancelled',
])

export const terminalServiceRequestStatuses = [
  'delivered',
  'planned_awaiting_capability',
  'partially_delivered',
  'rejected',
  'cancelled',
] as const

/**
 * Which lines the product can actually execute today.
 *
 * A single source of truth for the capability question, so a future line cannot become
 * executable by an accidental edit in a route handler. Widening this is a roadmap phase with
 * gates — see docs/ROADMAP_OUTREACH_TELEGRAM.md.
 */
export const executableServiceLines = ['seo_content'] as const

export function isExecutableServiceLine(line: ServiceLine): boolean {
  return (executableServiceLines as readonly string[]).includes(line)
}

/** Human-readable request number, e.g. `SR-2026-0001`. */
export const requestNumberSchema = z
  .string()
  .regex(/^SR-\d{4}-\d{4,}$/, 'request number must look like SR-2026-0001')

export const serviceRequestSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  requestNumber: requestNumberSchema,
  serviceLine: serviceLineSchema,
  verticalId: idSchema.nullable(),
  title: shortTextSchema,
  objective: mediumTextSchema,
  targetRegionIds: z.array(idSchema).max(64).default([]),
  locale: localeSchema,
  status: serviceRequestStatusSchema,
  statusReason: z.string().trim().max(2000).nullable(),
  requestedById: idSchema,
  /** Set on children of a `complex_package`. */
  parentRequestId: idSchema.nullable(),
  /** Set when the request grew out of an inbound lead. */
  originLeadId: idSchema.nullable(),
  deadlineHint: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const createServiceRequestSchema = z
  .object({
    serviceLine: serviceLineSchema,
    verticalId: idSchema.optional(),
    title: shortTextSchema,
    objective: mediumTextSchema,
    targetRegionIds: z.array(idSchema).max(64).default([]),
    locale: localeSchema.default('ru'),
    parentRequestId: idSchema.optional(),
    originLeadId: idSchema.optional(),
    deadlineHint: isoDateTimeSchema.optional(),
  })
  .strict()

export const updateServiceRequestSchema = createServiceRequestSchema.partial().strict()

/**
 * A status change always carries who and why. `rejected`, `on_hold` and `cancelled` require a
 * reason: a refusal without one is context the next session cannot recover.
 */
export const changeServiceRequestStatusSchema = z
  .object({
    status: serviceRequestStatusSchema,
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      !['rejected', 'on_hold', 'cancelled'].includes(value.status) ||
      (value.reason?.length ?? 0) > 0,
    { message: 'rejected, on_hold and cancelled require a reason', path: ['reason'] },
  )

export const serviceRequestEventSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  requestId: idSchema,
  fromStatus: serviceRequestStatusSchema.nullable(),
  toStatus: serviceRequestStatusSchema,
  reason: z.string().trim().max(2000).nullable(),
  actorId: idSchema.nullable(),
  occurredAt: isoDateTimeSchema,
})

export const listServiceRequestsQuerySchema = z.object({
  serviceLine: serviceLineSchema.optional(),
  status: serviceRequestStatusSchema.optional(),
  verticalId: idSchema.optional(),
})

export type ServiceLine = z.infer<typeof serviceLineSchema>
export type ServiceRequestStatus = z.infer<typeof serviceRequestStatusSchema>
export type ServiceRequest = z.infer<typeof serviceRequestSchema>
export type CreateServiceRequest = z.infer<typeof createServiceRequestSchema>
export type ChangeServiceRequestStatus = z.infer<typeof changeServiceRequestStatusSchema>
export type ServiceRequestEvent = z.infer<typeof serviceRequestEventSchema>
