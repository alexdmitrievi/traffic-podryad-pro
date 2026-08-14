import { z } from 'zod'
import {
  idSchema,
  isoDateTimeSchema,
  mediumTextSchema,
  shortTextSchema,
  timestampsSchema,
  workspaceIdSchema,
} from './common'

/**
 * The GEO query inventory (GEO wave, unit 2; docs/GEO.md): questions real users and
 * machine dialogues ask, triaged by a human into a lifecycle.
 *
 * A question describes the audience's demand and never enumerates a person. It points
 * at a cluster, product and region when those are known; the answer asset it feeds
 * arrives in unit 4.
 */

export const geoQueryPrioritySchema = z.enum(['low', 'medium', 'high'])

export const geoQueryStatusSchema = z.enum(['open', 'planned', 'answered', 'dismissed'])

/**
 * The lifecycle: open → planned → answered. Dismissal is possible at every triage
 * point and is terminal; a dismissal records why.
 */
export const geoQueryTransitionSchema = z.record(
  geoQueryStatusSchema,
  z.array(geoQueryStatusSchema),
)

export const geoQuerySchema = z
  .object({
    id: idSchema,
    workspaceId: workspaceIdSchema,
    question: mediumTextSchema,
    clusterId: idSchema.nullable(),
    productId: idSchema.nullable(),
    regionId: idSchema.nullable(),
    priority: geoQueryPrioritySchema,
    status: geoQueryStatusSchema,
    statusReason: shortTextSchema.nullable(),
    notes: shortTextSchema.nullable(),
  })
  .and(timestampsSchema)

export const createGeoQuerySchema = z
  .object({
    question: mediumTextSchema,
    clusterId: idSchema.optional(),
    productId: idSchema.optional(),
    regionId: idSchema.optional(),
    priority: geoQueryPrioritySchema.default('medium'),
    notes: shortTextSchema.optional(),
  })
  .strict()

/** Triage: only the status, its mandatory reason and the priority move here. */
export const updateGeoQuerySchema = z
  .object({
    status: geoQueryStatusSchema.optional(),
    statusReason: shortTextSchema.optional(),
    priority: geoQueryPrioritySchema.optional(),
  })
  .strict()
  .refine(
    (input) => input.status !== undefined || input.statusReason !== undefined || input.priority !== undefined,
    { message: 'the update must change at least one field' },
  )

export const geoQueryListQuerySchema = z.object({
  clusterId: idSchema.optional(),
  status: geoQueryStatusSchema.optional(),
})

export const geoQueryListSchema = z.object({
  queries: z.array(geoQuerySchema),
})

export type GeoQueryPriority = z.infer<typeof geoQueryPrioritySchema>
export type GeoQueryStatus = z.infer<typeof geoQueryStatusSchema>
export type GeoQuery = z.infer<typeof geoQuerySchema>
export type CreateGeoQuery = z.infer<typeof createGeoQuerySchema>
export type UpdateGeoQuery = z.infer<typeof updateGeoQuerySchema>
export type GeoQueryListQuery = z.infer<typeof geoQueryListQuerySchema>
