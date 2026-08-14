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
 * The evidence registry (GEO wave, unit 1): sources a human checked, claims extracted
 * from them, and citations pinpointing where each claim is supported.
 *
 * Facts in the petroleum niche are never invented — the registry is where a verified fact
 * lands before any content may use it (docs/GEO.md). A claim is usable by content only
 * when it is verified by a human and not superseded; supersession is how a correction
 * enters without rewriting history.
 */

export const evidenceSourceKindSchema = z.enum([
  'official_standard',
  'producer_document',
  'regulatory_document',
  'price_list',
  'industry_publication',
  'expert_statement',
  'other',
])

export const evidenceSourceSchema = z
  .object({
    id: idSchema,
    workspaceId: workspaceIdSchema,
    title: shortTextSchema,
    kind: evidenceSourceKindSchema,
    url: z.string().trim().max(2_000).nullable(),
    publishedAt: isoDateTimeSchema.nullable(),
    retrievedAt: isoDateTimeSchema.nullable(),
    verifiedAt: isoDateTimeSchema.nullable(),
    verifiedById: idSchema.nullable(),
    notes: mediumTextSchema.nullable(),
    claimCount: z.int().min(0),
  })
  .and(timestampsSchema)

export const createEvidenceSourceSchema = z
  .object({
    title: shortTextSchema,
    kind: evidenceSourceKindSchema,
    url: z.string().trim().max(2_000).optional(),
    publishedAt: isoDateTimeSchema.optional(),
    retrievedAt: isoDateTimeSchema.optional(),
    notes: mediumTextSchema.optional(),
  })
  .strict()

export const evidenceSourceListSchema = z.object({
  sources: z.array(evidenceSourceSchema),
})

/** Where in the source the claim is supported, so a person can find the fact again. */
export const claimCitationSchema = z.object({
  id: idSchema,
  location: shortTextSchema,
  quote: z.string().trim().max(2_000).nullable(),
})

export const claimStatusSchema = z.enum(['verified', 'unverified', 'superseded'])

export const claimSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  sourceId: idSchema,
  statement: mediumTextSchema,
  category: shortTextSchema.nullable(),
  verifiedAt: isoDateTimeSchema.nullable(),
  verifiedById: idSchema.nullable(),
  supersededById: idSchema.nullable(),
  status: claimStatusSchema,
  citations: z.array(claimCitationSchema),
  createdAt: isoDateTimeSchema,
})

export const claimCitationInputSchema = z
  .object({
    location: shortTextSchema,
    quote: z.string().trim().max(2_000).optional(),
  })
  .strict()

export const createClaimSchema = z
  .object({
    sourceId: idSchema,
    statement: mediumTextSchema,
    category: shortTextSchema.optional(),
    citations: z.array(claimCitationInputSchema).max(20).default([]),
  })
  .strict()

/**
 * A correction is a new claim that supersedes the old one, never an edit in place.
 * Omitted fields are inherited from the superseded claim; the new claim starts
 * unverified and must be verified again.
 */
export const supersedeClaimSchema = z
  .object({
    statement: mediumTextSchema.optional(),
    sourceId: idSchema.optional(),
    category: shortTextSchema.nullable().optional(),
    citations: z.array(claimCitationInputSchema).max(20).optional(),
  })
  .strict()

export const claimListQuerySchema = z.object({
  sourceId: idSchema.optional(),
  status: claimStatusSchema.optional(),
})

export const claimListSchema = z.object({
  claims: z.array(claimSchema),
})

export type EvidenceSourceKind = z.infer<typeof evidenceSourceKindSchema>
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>
export type CreateEvidenceSource = z.infer<typeof createEvidenceSourceSchema>
export type ClaimCitation = z.infer<typeof claimCitationSchema>
export type ClaimStatus = z.infer<typeof claimStatusSchema>
export type Claim = z.infer<typeof claimSchema>
export type CreateClaim = z.infer<typeof createClaimSchema>
export type SupersedeClaim = z.infer<typeof supersedeClaimSchema>
export type ClaimListQuery = z.infer<typeof claimListQuerySchema>
