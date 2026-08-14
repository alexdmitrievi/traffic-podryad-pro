import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { KeywordSourcePort } from '../../../providers/keywords/port'
import { KeywordImportRejectedError } from '../../../providers/keywords/port'
import type { Db } from '../../../db'
import type { AuthMiddleware } from '../../auth'
import { createClusters, importKeywords, listClusters, listKeywords } from '../application/research'

export interface ResearchRoutesDeps {
  db: Db
  keywordSource: KeywordSourcePort
  requireAuth: AuthMiddleware
  requireEditor: AuthMiddleware
}

export function createResearchRoutes(deps: ResearchRoutesDeps): Hono {
  const routes = new Hono()
  const depsFull = { db: deps.db, keywordSource: deps.keywordSource }

  routes.post('/imports', deps.requireAuth, deps.requireEditor, async (c) => {
    const parsed = contracts.research.keywords.keywordCsvImportSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid import payload' } }, 400)
    }

    try {
      const result = await importKeywords(depsFull, {
        requestId: parsed.data.requestId,
        csv: parsed.data.csv,
        provider: parsed.data.provider,
        locale: 'ru',
      })
      return c.json(contracts.research.keywords.keywordImportResultSchema.parse(result))
    } catch (error) {
      if (error instanceof KeywordImportRejectedError) {
        return c.json(
          {
            error: {
              code: 'IMPORT_REJECTED',
              message: error.message,
              details: error.problems,
            },
          },
          422,
        )
      }
      throw error
    }
  })

  routes.get('/keywords', deps.requireAuth, async (c) => {
    const requestId = c.req.query('requestId') ?? undefined
    const keywords = await listKeywords(depsFull, { requestId })
    return c.json({ keywords: keywords.map(serializeKeyword) })
  })

  routes.post('/clusters', deps.requireAuth, deps.requireEditor, async (c) => {
    const body = (await c.req.json()) as { requestId?: string }
    const requestId = contracts.common.idSchema.safeParse(body?.requestId)
    if (!requestId.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'requestId is required' } }, 400)
    }

    const result = await createClusters(depsFull, { requestId: requestId.data })
    return c.json(result, 201)
  })

  routes.get('/clusters', deps.requireAuth, async (c) => {
    const requestId = c.req.query('requestId') ?? undefined
    const clusters = await listClusters(depsFull, { requestId })
    return c.json({
      clusters: clusters.map((cluster) => ({
        ...serializeCluster(cluster),
        keywords: cluster.keywords,
      })),
    })
  })

  return routes
}

const serializeKeyword = (keyword: {
  id: string
  workspaceId: string
  requestId: string | null
  phrase: string
  normalizedPhrase: string
  locale: string
  intent: string
  productId: string | null
  regionId: string | null
  source: string
  importedAt: Date
  createdAt: Date
}) => ({
  id: keyword.id,
  workspaceId: keyword.workspaceId,
  phrase: keyword.phrase,
  normalizedPhrase: keyword.normalizedPhrase,
  locale: keyword.locale,
  intent: keyword.intent,
  productId: keyword.productId,
  regionId: keyword.regionId,
  source: keyword.source,
  importedAt: keyword.importedAt.toISOString(),
  createdAt: keyword.createdAt.toISOString(),
})

const serializeCluster = (cluster: {
  id: string
  workspaceId: string
  requestId: string
  title: string
  summary: string | null
  pillarKeywordId: string | null
  productId: string | null
  regionId: string | null
  status: string
  createdAt: Date
  updatedAt: Date
}) => ({
  id: cluster.id,
  workspaceId: cluster.workspaceId,
  requestId: cluster.requestId,
  title: cluster.title,
  summary: cluster.summary,
  pillarKeywordId: cluster.pillarKeywordId,
  productId: cluster.productId,
  regionId: cluster.regionId,
  status: cluster.status,
  createdAt: cluster.createdAt.toISOString(),
  updatedAt: cluster.updatedAt.toISOString(),
})
