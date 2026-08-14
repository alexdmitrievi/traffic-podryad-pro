import { z } from 'zod'
import {
  contentHashSchema,
  idSchema,
  mediumTextSchema,
  timestampsSchema,
  workspaceIdSchema,
} from './common'

/**
 * GEO answer assets (GEO wave, unit 4; docs/GEO.md): the answering material for one
 * inventory question, written and fact-checked by a human.
 *
 * The body must be built on verified claims from the evidence registry — every linked
 * claim is checked at save and at approval. Approval goes through the shared approvals
 * context bound to the asset's content hash; approving the asset answers the question.
 */

export const geoAnswerSchema = z
  .object({
    id: idSchema,
    workspaceId: workspaceIdSchema,
    queryId: idSchema,
    bodyMarkdown: z.string().max(50_000),
    contentHash: contentHashSchema,
    linkedClaimIds: z.array(idSchema).max(50),
  })
  .and(timestampsSchema)

/** The list response carries the question text for display, alongside the approval state. */
export const geoAnswerWithApprovalSchema = geoAnswerSchema.and(
  z.object({
    question: mediumTextSchema,
    isApproved: z.boolean(),
    approvalId: idSchema.nullable(),
  }),
)

export const createGeoAnswerSchema = z
  .object({
    bodyMarkdown: z.string().max(50_000).default(''),
    linkedClaimIds: z.array(idSchema).max(50).default([]),
  })
  .strict()

export const updateGeoAnswerSchema = z
  .object({
    bodyMarkdown: z.string().max(50_000).optional(),
    linkedClaimIds: z.array(idSchema).max(50).optional(),
  })
  .strict()
  .refine(
    (input) => input.bodyMarkdown !== undefined || input.linkedClaimIds !== undefined,
    { message: 'the update must change at least one field' },
  )

/** The approval gate: the hash the reviewer saw must be the one the asset carries now. */
export const approveGeoAnswerSchema = z
  .object({
    contentHash: contentHashSchema,
    note: mediumTextSchema.optional(),
  })
  .strict()

export const geoAnswerListQuerySchema = z.object({
  queryId: idSchema.optional(),
})

export const geoAnswerListSchema = z.object({
  answers: z.array(geoAnswerWithApprovalSchema),
})

export type GeoAnswer = z.infer<typeof geoAnswerSchema>
export type GeoAnswerWithApproval = z.infer<typeof geoAnswerWithApprovalSchema>
export type CreateGeoAnswer = z.infer<typeof createGeoAnswerSchema>
export type UpdateGeoAnswer = z.infer<typeof updateGeoAnswerSchema>
export type ApproveGeoAnswer = z.infer<typeof approveGeoAnswerSchema>
export type GeoAnswerListQuery = z.infer<typeof geoAnswerListQuerySchema>
