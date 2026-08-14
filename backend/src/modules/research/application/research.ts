import type { KeywordIntent } from '@traffic/contracts'
import type { Db } from '../../../db'
import type { KeywordRow, KeywordSourcePort } from '../../../providers/keywords/port'
import { KeywordImportRejectedError } from '../../../providers/keywords/port'
import { classifyIntent, clusterKeywords, normalizeKeyword } from '../domain/research'

export interface ResearchDeps {
  db: Db
  keywordSource: KeywordSourcePort
}

export interface KeywordImportResult {
  received: number
  created: number
  duplicates: number
  metricsRecorded: number
}

/**
 * Import: the file goes through the port (accepted or rejected entirely), then each row
 * is normalized, classified, bound to a product and a region by synonym matching, and
 * stored. Re-imports add a metric snapshot instead of creating duplicates
 * (docs/CONTENT_PIPELINE.md steps 2–5).
 */
export async function importKeywords(
  deps: ResearchDeps,
  input: { requestId: string; csv: string; provider: string; locale: string },
): Promise<KeywordImportResult> {
  const parsed = await deps.keywordSource.importKeywords({ csv: input.csv })

  const workspace = await deps.db.workspace.findFirstOrThrow()
  const products = await deps.db.product.findMany({ where: { workspaceId: workspace.id } })
  const regions = await deps.db.region.findMany({ where: { workspaceId: workspace.id } })

  let created = 0
  let duplicates = 0
  let metricsRecorded = 0
  const normalizedRows: KeywordRow[] = []

  for (const row of parsed.rows) {
    const normalizedPhrase = normalizeKeyword(row.phrase)
    if (normalizedPhrase === '') continue

    const product = products.find(
      (candidate) =>
        candidate.name.toLowerCase() === normalizedPhrase ||
        candidate.synonyms.some((synonym) => normalizeKeyword(synonym) === normalizedPhrase),
    )
    const region = regions.find((candidate) => normalizedPhrase.includes(candidate.name.toLowerCase()))

    const existing = await deps.db.keyword.findUnique({
      where: {
        workspaceId_normalizedPhrase_locale: {
          workspaceId: workspace.id,
          normalizedPhrase,
          locale: input.locale,
        },
      },
    })

    if (existing) {
      duplicates += 1
      if (row.volume !== null) {
        await deps.db.keywordMetric.create({
          data: {
            workspaceId: workspace.id,
            keywordId: existing.id,
            provider: input.provider,
            volume: row.volume,
            capturedAt: new Date(),
          },
        })
        metricsRecorded += 1
      }
      continue
    }

    const createdRow = await deps.db.keyword.create({
      data: {
        workspaceId: workspace.id,
        requestId: input.requestId,
        phrase: row.phrase.trim(),
        normalizedPhrase,
        locale: input.locale,
        intent: classifyIntent(normalizedPhrase) as KeywordIntent,
        productId: product?.id ?? null,
        regionId: region?.id ?? null,
        source: 'csv_import',
      },
    })
    created += 1
    normalizedRows.push(row)

    if (row.volume !== null) {
      await deps.db.keywordMetric.create({
        data: {
          workspaceId: workspace.id,
          keywordId: createdRow.id,
          provider: input.provider,
          volume: row.volume,
          capturedAt: new Date(),
        },
      })
      metricsRecorded += 1
    }
  }

  return { received: parsed.rows.length, created, duplicates, metricsRecorded }
}

export interface ClusterCreationResult {
  clustersCreated: number
}

/**
 * Lexical clustering of the request's keywords (docs/WAVE_4_DELEGATION.md section 6):
 * clusters are defined by membership and a pillar keyword, and carry the dominant
 * product and region of their members. Titles are derived from the pillar phrase.
 */
export async function createClusters(
  deps: ResearchDeps,
  input: { requestId: string; threshold?: number },
): Promise<ClusterCreationResult> {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  const keywords = await deps.db.keyword.findMany({
    where: { workspaceId: workspace.id, requestId: input.requestId },
    include: { metrics: { orderBy: { capturedAt: 'desc' }, take: 1 } },
  })

  const clusters = clusterKeywords(
    keywords.map((keyword) => ({
      id: keyword.id,
      phrase: keyword.normalizedPhrase,
      volume: keyword.metrics[0]?.volume ?? null,
      productId: keyword.productId,
      regionId: keyword.regionId,
    })),
    input.threshold ?? 0.2,
  )

  let clustersCreated = 0
  for (const cluster of clusters) {
    const created = await deps.db.topicCluster.create({
      data: {
        workspaceId: workspace.id,
        requestId: input.requestId,
        title: cluster.pillar.phrase,
        pillarKeywordId: cluster.pillar.id,
        productId: cluster.productId,
        regionId: cluster.regionId,
        status: 'draft',
        keywords: {
          create: cluster.members.map((member) => ({
            keywordId: member.id,
            relevance: 1,
          })),
        },
      },
    })
    clustersCreated += 1
  }

  return { clustersCreated }
}

export async function listKeywords(deps: ResearchDeps, input: { requestId?: string }) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  return deps.db.keyword.findMany({
    where: { workspaceId: workspace.id, ...(input.requestId ? { requestId: input.requestId } : {}) },
    orderBy: { createdAt: 'asc' },
  })
}

export async function listClusters(deps: ResearchDeps, input: { requestId?: string }) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  return deps.db.topicCluster.findMany({
    where: { workspaceId: workspace.id, ...(input.requestId ? { requestId: input.requestId } : {}) },
    include: { keywords: true },
    orderBy: { createdAt: 'asc' },
  })
}
