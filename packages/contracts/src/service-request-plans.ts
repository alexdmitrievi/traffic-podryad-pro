import { z } from 'zod'
import {
  contentHashSchema,
  idSchema,
  isoDateTimeSchema,
  mediumTextSchema,
  shortTextSchema,
  workspaceIdSchema,
} from './common'

/**
 * Versioned plans, one shape per service line.
 *
 * The plan content is a discriminated union rather than a free JSON blob, because the shape
 * is where the compliance boundary lives. Read the outreach and Telegram shapes closely:
 * neither has a recipients field, a contact list, or anything that could hold a person. A
 * plan describes an audience; it never enumerates one. That is a structural property of these
 * types, not a runtime check somebody can skip.
 *
 * See docs/SERVICE_REQUESTS.md section 4 and docs/ROADMAP_OUTREACH_TELEGRAM.md.
 */

export const planKindSchema = z.enum([
  'seo_content',
  'b2b_outreach',
  'telegram_marketing',
  'complex_package',
])

export const planStatusSchema = z.enum(['draft', 'approved'])

export const authorKindSchema = z.enum(['human', 'llm'])

const kpiSchema = z
  .array(
    z.object({
      name: shortTextSchema,
      target: shortTextSchema,
    }),
  )
  .max(20)

// ── seo_content: the only executable plan in the MVP ─────────────────────────

export const seoContentPlanSchema = z.object({
  kind: z.literal('seo_content'),
  goals: z.array(mediumTextSchema).min(1).max(20),
  targetClusterIds: z.array(idSchema).max(200).default([]),
  targetProductIds: z.array(idSchema).max(200).default([]),
  targetRegionIds: z.array(idSchema).max(64).default([]),
  plannedArticleCount: z.int().min(1).max(1000),
  qualityCriteria: z.array(mediumTextSchema).max(20).default([]),
  approvalCriteria: z.array(mediumTextSchema).max(20).default([]),
  kpis: kpiSchema.default([]),
})

// ── b2b_outreach: planning only ──────────────────────────────────────────────

/**
 * Describes an audience profile. There is no recipients field and no contact storage, at any
 * level of this type: outreach has no execution capability in the MVP, and the plan is not a
 * back door into building a list.
 *
 * `assumedLegalBasis` has no default. Someone has to write down why this communication would
 * be lawful, and an empty string is not an answer — but it is a lawyer's answer, not an
 * engineer's, and phase 1 of the roadmap does not open without one.
 */
export const b2bOutreachPlanSchema = z.object({
  kind: z.literal('b2b_outreach'),
  idealCustomerProfile: mediumTextSchema,
  segments: z
    .array(
      z.object({
        name: shortTextSchema,
        /** Descriptive traits: industry, size, role, region. Never identifiers of people. */
        traits: z.array(shortTextSchema).min(1).max(20),
        estimatedSize: z.int().min(0).nullable(),
      }),
    )
    .min(1)
    .max(50),
  valueHypotheses: z.array(mediumTextSchema).min(1).max(20),
  assumedChannels: z.array(shortTextSchema).max(10).default([]),
  assumedLegalBasis: mediumTextSchema,
  kpis: kpiSchema.default([]),
})

// ── telegram_marketing: planning only ────────────────────────────────────────

/**
 * Own-channel concept and inbound scenarios. No recipients, no broadcast mechanics, no
 * member lists. The bot model is opt-in only: the person always speaks first.
 */
export const telegramMarketingPlanSchema = z.object({
  kind: z.literal('telegram_marketing'),
  channelConcept: mediumTextSchema,
  optInMechanics: mediumTextSchema,
  contentPlan: z
    .array(
      z.object({
        topic: shortTextSchema,
        cadence: shortTextSchema,
      }),
    )
    .max(50)
    .default([]),
  /** Scenarios that begin with an incoming message from the user, never with ours. */
  inboundScenarios: z.array(mediumTextSchema).max(30).default([]),
  kpis: kpiSchema.default([]),
})

// ── complex_package: decomposition ───────────────────────────────────────────

export const complexPackagePlanSchema = z.object({
  kind: z.literal('complex_package'),
  overallGoal: mediumTextSchema,
  childRequests: z
    .array(
      z.object({
        serviceLine: planKindSchema.exclude(['complex_package']),
        title: shortTextSchema,
        objective: mediumTextSchema,
      }),
    )
    .min(1)
    .max(20),
  kpis: kpiSchema.default([]),
})

export const planContentSchema = z.discriminatedUnion('kind', [
  seoContentPlanSchema,
  b2bOutreachPlanSchema,
  telegramMarketingPlanSchema,
  complexPackagePlanSchema,
])

export const serviceRequestPlanSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  requestId: idSchema,
  version: z.int().min(1),
  planKind: planKindSchema,
  content: planContentSchema,
  /** Hash of the exact plan content an approval points at. */
  contentHash: contentHashSchema,
  authorKind: authorKindSchema,
  authorId: idSchema.nullable(),
  llmRunId: idSchema.nullable(),
  status: planStatusSchema,
  createdAt: isoDateTimeSchema,
})

export const createServiceRequestPlanSchema = z
  .object({
    requestId: idSchema,
    content: planContentSchema,
  })
  .strict()

export type PlanKind = z.infer<typeof planKindSchema>
export type PlanStatus = z.infer<typeof planStatusSchema>
export type AuthorKind = z.infer<typeof authorKindSchema>
export type PlanContent = z.infer<typeof planContentSchema>
export type SeoContentPlan = z.infer<typeof seoContentPlanSchema>
export type B2bOutreachPlan = z.infer<typeof b2bOutreachPlanSchema>
export type TelegramMarketingPlan = z.infer<typeof telegramMarketingPlanSchema>
export type ComplexPackagePlan = z.infer<typeof complexPackagePlanSchema>
export type ServiceRequestPlan = z.infer<typeof serviceRequestPlanSchema>
