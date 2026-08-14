import { z } from 'zod'
import {
  idSchema,
  isoDateTimeSchema,
  mediumTextSchema,
  shortTextSchema,
  workspaceIdSchema,
} from './common'

/**
 * Manual GEO visibility snapshots (GEO wave, unit 3; docs/GEO.md): what a person saw
 * in a real search or assistant interface for a question from the inventory.
 *
 * Append-only by design — every capture is a new row, so the series over time is the
 * visibility signal. Nothing here is scraped or automated.
 */

/** Open set: the interfaces differ and new ones appear. Validated in code. */
export const geoSearchEngineSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, 'engine code must be lowercase letters, digits, dashes and underscores')

export const geoVisibilitySnapshotSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  queryId: idSchema,
  searchEngine: geoSearchEngineSchema,
  searchPhrase: mediumTextSchema.nullable(),
  brandMentioned: z.boolean(),
  mentionPosition: z.int().min(1).nullable(),
  answerExcerpt: mediumTextSchema.nullable(),
  capturedAt: isoDateTimeSchema,
  notes: shortTextSchema.nullable(),
  createdAt: isoDateTimeSchema,
})

export const createGeoVisibilitySnapshotSchema = z
  .object({
    searchEngine: geoSearchEngineSchema,
    searchPhrase: mediumTextSchema.optional(),
    brandMentioned: z.boolean(),
    mentionPosition: z.int().min(1).optional(),
    answerExcerpt: mediumTextSchema.optional(),
    capturedAt: isoDateTimeSchema.optional(),
    notes: shortTextSchema.optional(),
  })
  .strict()
  .refine(
    (input) => input.brandMentioned || input.mentionPosition === undefined,
    { message: 'mentionPosition belongs to a present mention; drop it when the brand is absent' },
  )

export const geoVisibilitySnapshotListSchema = z.object({
  snapshots: z.array(geoVisibilitySnapshotSchema),
})

export type GeoSearchEngine = z.infer<typeof geoSearchEngineSchema>
export type GeoVisibilitySnapshot = z.infer<typeof geoVisibilitySnapshotSchema>
export type CreateGeoVisibilitySnapshot = z.infer<typeof createGeoVisibilitySnapshotSchema>
