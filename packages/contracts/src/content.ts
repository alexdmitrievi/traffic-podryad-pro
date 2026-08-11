import { z } from 'zod'
import {
  contentHashSchema,
  idSchema,
  isoDateTimeSchema,
  localeSchema,
  longTextSchema,
  mediumTextSchema,
  shortTextSchema,
  slugSchema,
  workspaceIdSchema,
} from './common'
import { authorKindSchema } from './service-request-plans'

/**
 * Briefs, articles and their revisions.
 *
 * Two properties carry the product's central invariant:
 *
 *   - a revision is immutable. Editing produces a new row, never an update, so the history
 *     is the audit trail rather than a side effect of one;
 *   - a revision carries a content hash. An approval points at that hash, so editing after
 *     approval detaches the approval automatically.
 *
 * See docs/CONTENT_PIPELINE.md steps 8 to 16.
 */

// ── Briefs ───────────────────────────────────────────────────────────────────

export const briefStatusSchema = z.enum(['draft', 'in_review', 'approved', 'rejected'])

export const briefOutlineSectionSchema = z.object({
  heading: shortTextSchema,
  intent: mediumTextSchema.nullable(),
  /**
   * Places the writer must confirm against a source before publication. The generator is
   * required to mark them rather than invent a plausible value — a draft on a technical
   * topic with no markers at all is itself a reason for suspicion.
   * See docs/PETROLEUM_TAXONOMY.md.
   */
  factsToVerify: z.array(mediumTextSchema).max(20).default([]),
})

export const contentBriefSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  clusterId: idSchema,
  title: shortTextSchema,
  outline: z.array(briefOutlineSectionSchema).min(1).max(50),
  targetKeywordIds: z.array(idSchema).max(200).default([]),
  audience: mediumTextSchema.nullable(),
  tone: shortTextSchema.nullable(),
  status: briefStatusSchema,
  authorKind: authorKindSchema,
  llmRunId: idSchema.nullable(),
  contentHash: contentHashSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

// ── Articles ─────────────────────────────────────────────────────────────────

export const contentStatusSchema = z.enum([
  'draft',
  'in_review',
  'approved',
  'published',
  'archived',
])

export const contentItemSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  briefId: idSchema,
  slug: slugSchema,
  title: shortTextSchema,
  locale: localeSchema,
  productId: idSchema.nullable(),
  regionId: idSchema.nullable(),
  status: contentStatusSchema,
  currentRevisionId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

/** Immutable. A new save is a new row. */
export const contentRevisionSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  contentItemId: idSchema,
  revisionNumber: z.int().min(1),
  bodyMarkdown: longTextSchema,
  metaTitle: shortTextSchema.nullable(),
  metaDescription: z.string().trim().max(320).nullable(),
  /** SHA-256 of the exact bytes an approval binds to. */
  contentHash: contentHashSchema,
  authorKind: authorKindSchema,
  authorId: idSchema.nullable(),
  llmRunId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
})

export const createContentRevisionSchema = z
  .object({
    contentItemId: idSchema,
    bodyMarkdown: longTextSchema,
    metaTitle: shortTextSchema.optional(),
    metaDescription: z.string().trim().max(320).optional(),
  })
  .strict()

// ── Publications ─────────────────────────────────────────────────────────────

export const publicationTargetSchema = z.enum(['internal_website', 'export'])

export const publicationStatusSchema = z.enum(['pending', 'published', 'unpublished', 'failed'])

/**
 * `approvalId` is not optional and not nullable, here or in the database. Publication without
 * an approval is impossible by construction rather than by a check a new route could miss.
 */
export const publicationSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  contentItemId: idSchema,
  revisionId: idSchema,
  approvalId: idSchema,
  target: publicationTargetSchema,
  status: publicationStatusSchema,
  publicUrl: z.url().nullable(),
  publishedAt: isoDateTimeSchema.nullable(),
  publishedById: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
})

export const publishRequestSchema = z
  .object({
    contentItemId: idSchema,
    revisionId: idSchema,
    target: publicationTargetSchema.default('internal_website'),
  })
  .strict()

// ── Calls to action ──────────────────────────────────────────────────────────

export const ctaPlacementSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  contentItemId: idSchema,
  variant: shortTextSchema,
  formSlug: slugSchema,
  createdAt: isoDateTimeSchema,
})

export type BriefStatus = z.infer<typeof briefStatusSchema>
export type ContentBrief = z.infer<typeof contentBriefSchema>
export type ContentStatus = z.infer<typeof contentStatusSchema>
export type ContentItem = z.infer<typeof contentItemSchema>
export type ContentRevision = z.infer<typeof contentRevisionSchema>
export type PublicationTarget = z.infer<typeof publicationTargetSchema>
export type Publication = z.infer<typeof publicationSchema>
export type CtaPlacement = z.infer<typeof ctaPlacementSchema>
