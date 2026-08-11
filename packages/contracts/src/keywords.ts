import { z } from 'zod'
import {
  idSchema,
  isoDateTimeSchema,
  localeSchema,
  shortTextSchema,
  workspaceIdSchema,
} from './common'

/**
 * Keywords and their metrics.
 *
 * The only source in the MVP is a CSV export uploaded by a person: no API keys, no rate
 * limits, no network. A second driver goes behind the same port later.
 */

export const keywordIntentSchema = z.enum([
  'informational',
  'commercial',
  'transactional',
  'navigational',
  'unknown',
])

export const keywordSourceSchema = z.enum(['csv_import', 'manual'])

export const keywordSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  phrase: shortTextSchema,
  /** Case-folded, whitespace-collapsed form. The deduplication key, not a display value. */
  normalizedPhrase: shortTextSchema,
  locale: localeSchema,
  intent: keywordIntentSchema,
  productId: idSchema.nullable(),
  regionId: idSchema.nullable(),
  source: keywordSourceSchema,
  importedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
})

/**
 * A metric snapshot, never an update in place.
 *
 * Search volume moving over time is the signal the whole pipeline exists to act on;
 * overwriting the previous value would throw it away on every import.
 */
export const keywordMetricSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  keywordId: idSchema,
  provider: z.string().trim().min(1).max(64),
  volume: z.int().min(0).nullable(),
  difficulty: z.number().min(0).max(100).nullable(),
  capturedAt: isoDateTimeSchema,
})

/** One row of an uploaded CSV, after header mapping. */
export const keywordImportRowSchema = z.object({
  phrase: shortTextSchema,
  volume: z.coerce.number().int().min(0).optional(),
  difficulty: z.coerce.number().min(0).max(100).optional(),
  intent: keywordIntentSchema.optional(),
})

/**
 * The whole file is accepted or rejected. A partial import leaves the workspace in a state
 * nobody can describe, which is worse than no import at all.
 */
export const keywordImportRequestSchema = z
  .object({
    requestId: idSchema,
    provider: z.string().trim().min(1).max(64).default('csv'),
    locale: localeSchema.default('ru'),
    rows: z.array(keywordImportRowSchema).min(1).max(50_000),
  })
  .strict()

export const keywordImportResultSchema = z.object({
  received: z.int().min(0),
  created: z.int().min(0),
  duplicates: z.int().min(0),
  metricsRecorded: z.int().min(0),
})

export type KeywordIntent = z.infer<typeof keywordIntentSchema>
export type Keyword = z.infer<typeof keywordSchema>
export type KeywordMetric = z.infer<typeof keywordMetricSchema>
export type KeywordImportRequest = z.infer<typeof keywordImportRequestSchema>
export type KeywordImportResult = z.infer<typeof keywordImportResultSchema>
