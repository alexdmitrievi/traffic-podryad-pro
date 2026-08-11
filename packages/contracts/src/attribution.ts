import { z } from 'zod'
import { idSchema, isoDateTimeSchema, shortTextSchema, workspaceIdSchema } from './common'

/**
 * First-party attribution: the chain the whole pipeline exists to produce.
 *
 *   lead → touch → content item → cluster → keyword → product → region
 *
 * Every link is a real foreign key, not a join reconstructed from matching strings after the
 * fact. Without this chain, content production is an act of faith.
 *
 * `visitorId` is a random identifier and carries no personal data. It is not an account and
 * grants nothing. See docs/ATTRIBUTION.md.
 */

/**
 * First and last touch are kept, and they answer different questions: first touch says what
 * attracts, last touch says what converts. Reporting one as the other is the usual way
 * content evaluation goes wrong. Multi-touch weighting is deliberately absent — it needs more
 * data than the MVP will have and produces precision nothing can check.
 */
export const touchPositionSchema = z.enum(['first', 'last', 'middle'])

export const attributionTouchSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  visitorId: idSchema,
  leadId: idSchema.nullable(),
  contentItemId: idSchema.nullable(),
  path: z.string().trim().max(2048),
  referrer: z.string().trim().max(2048).nullable(),
  utmSource: shortTextSchema.nullable(),
  utmMedium: shortTextSchema.nullable(),
  utmCampaign: shortTextSchema.nullable(),
  utmContent: shortTextSchema.nullable(),
  utmTerm: shortTextSchema.nullable(),
  position: touchPositionSchema.nullable(),
  occurredAt: isoDateTimeSchema,
})

/** Recorded from the public site before anyone becomes a lead. No credentials involved. */
export const recordTouchRequestSchema = z
  .object({
    visitorId: idSchema,
    path: z.string().trim().max(2048),
    referrer: z.string().trim().max(2048).optional(),
    contentItemId: idSchema.optional(),
    utmSource: shortTextSchema.optional(),
    utmMedium: shortTextSchema.optional(),
    utmCampaign: shortTextSchema.optional(),
    utmContent: shortTextSchema.optional(),
    utmTerm: shortTextSchema.optional(),
  })
  .strict()

export const recordTouchResponseSchema = z.object({
  recorded: z.literal(true),
})

/** The resolved chain for one lead — the thing the MVP has to be able to show. */
export const attributionChainSchema = z.object({
  leadId: idSchema,
  firstTouch: attributionTouchSchema.nullable(),
  lastTouch: attributionTouchSchema.nullable(),
  contentItemId: idSchema.nullable(),
  contentTitle: shortTextSchema.nullable(),
  clusterId: idSchema.nullable(),
  clusterTitle: shortTextSchema.nullable(),
  keywordId: idSchema.nullable(),
  keywordPhrase: shortTextSchema.nullable(),
  productId: idSchema.nullable(),
  productName: shortTextSchema.nullable(),
  regionId: idSchema.nullable(),
  regionName: shortTextSchema.nullable(),
})

export const funnelSummarySchema = z.object({
  publishedContentCount: z.int().min(0),
  leadCount: z.int().min(0),
  attributedLeadCount: z.int().min(0),
  byCluster: z.array(
    z.object({ clusterId: idSchema, clusterTitle: shortTextSchema, leadCount: z.int().min(0) }),
  ),
  byProduct: z.array(
    z.object({ productId: idSchema, productName: shortTextSchema, leadCount: z.int().min(0) }),
  ),
  byRegion: z.array(
    z.object({ regionId: idSchema, regionName: shortTextSchema, leadCount: z.int().min(0) }),
  ),
})

export type TouchPosition = z.infer<typeof touchPositionSchema>
export type AttributionTouch = z.infer<typeof attributionTouchSchema>
export type RecordTouchRequest = z.infer<typeof recordTouchRequestSchema>
export type AttributionChain = z.infer<typeof attributionChainSchema>
export type FunnelSummary = z.infer<typeof funnelSummarySchema>
