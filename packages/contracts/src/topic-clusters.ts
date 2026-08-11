import { z } from 'zod'
import {
  idSchema,
  isoDateTimeSchema,
  mediumTextSchema,
  shortTextSchema,
  workspaceIdSchema,
} from './common'

/**
 * Topic clusters group keywords into something a person can write about.
 *
 * Note what is absent: an embedding field. Clustering is intended to run on embeddings in
 * PostgreSQL, but the production verification gate for pgvector is unresolved
 * (docs/DEPLOYMENT.md section 3), so no vector reaches the contract or the schema yet. The
 * cluster is defined by its membership and its pillar keyword, which stays true whichever
 * way the similarity is computed.
 */

export const topicClusterStatusSchema = z.enum([
  'draft',
  'selected',
  'briefed',
  'published',
  'archived',
])

export const topicClusterSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  requestId: idSchema,
  title: shortTextSchema,
  summary: mediumTextSchema.nullable(),
  pillarKeywordId: idSchema.nullable(),
  productId: idSchema.nullable(),
  regionId: idSchema.nullable(),
  status: topicClusterStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const clusterKeywordSchema = z.object({
  clusterId: idSchema,
  keywordId: idSchema,
  /** How strongly the keyword belongs to this cluster, 0..1. */
  relevance: z.number().min(0).max(1),
})

export const createTopicClusterSchema = z
  .object({
    requestId: idSchema,
    title: shortTextSchema,
    summary: mediumTextSchema.optional(),
    pillarKeywordId: idSchema.optional(),
    productId: idSchema.optional(),
    regionId: idSchema.optional(),
    keywordIds: z.array(idSchema).min(1).max(500),
  })
  .strict()

export const topicClusterWithKeywordsSchema = topicClusterSchema.extend({
  keywords: z.array(clusterKeywordSchema),
})

export type TopicClusterStatus = z.infer<typeof topicClusterStatusSchema>
export type TopicCluster = z.infer<typeof topicClusterSchema>
export type ClusterKeyword = z.infer<typeof clusterKeywordSchema>
export type CreateTopicCluster = z.infer<typeof createTopicClusterSchema>
