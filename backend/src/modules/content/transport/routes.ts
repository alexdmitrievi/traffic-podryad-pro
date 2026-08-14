import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { AuthMiddleware } from '../../auth'
import type { ContentDeps } from '../application/content'
import {
  createBrief,
  createItem,
  createRevision,
  getItem,
  listBriefs,
  listItems,
  reviewBrief,
} from '../application/content'

export interface ContentRoutesDeps {
  deps: ContentDeps
  requireAuth: AuthMiddleware
  requireEditor: AuthMiddleware
}

const serializeBrief = (brief: object) => ({
  ...(brief as Record<string, unknown>),
  createdAt: (brief as { createdAt: Date }).createdAt.toISOString(),
  updatedAt: (brief as { updatedAt: Date }).updatedAt.toISOString(),
})

const serializeItem = (item: object) => ({
  ...(item as Record<string, unknown>),
  createdAt: (item as { createdAt: Date }).createdAt.toISOString(),
  updatedAt: (item as { updatedAt: Date }).updatedAt.toISOString(),
})

const serializeRevision = (revision: object) => ({
  ...(revision as Record<string, unknown>),
  createdAt: (revision as { createdAt: Date }).createdAt.toISOString(),
})

export function createContentRoutes(deps: ContentRoutesDeps): Hono {
  const routes = new Hono()

  routes.post('/briefs', deps.requireAuth, deps.requireEditor, async (c) => {
    const body = (await c.req.json()) as { clusterId?: string }
    if (!contracts.common.idSchema.safeParse(body?.clusterId).success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'clusterId is required' } }, 400)
    }

    const brief = await createBrief(deps.deps, { clusterId: body.clusterId!, actorId: c.get('principal').userId })
    if (!brief) return c.json({ error: { code: 'NOT_FOUND', message: 'Cluster not found' } }, 404)

    return c.json(contracts.content.contentBriefSchema.parse(serializeBrief(brief)), 201)
  })

  routes.get('/briefs', deps.requireAuth, async (c) => {
    const clusterId = c.req.query('clusterId') ?? undefined
    const briefs = await listBriefs(deps.deps, { clusterId })
    return c.json({ briefs: briefs.map((brief) => contracts.content.contentBriefSchema.parse(serializeBrief(brief))) })
  })

  routes.post('/briefs/:id/review', deps.requireAuth, deps.requireEditor, async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json()) as { decision?: 'approve' | 'reject' }
    if (body?.decision !== 'approve' && body?.decision !== 'reject') {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'decision must be approve or reject' } }, 400)
    }

    const ok = await reviewBrief(deps.deps, { briefId: id, approve: body.decision === 'approve' })
    if (!ok) return c.json({ error: { code: 'CONFLICT', message: 'Brief is not awaiting review' } }, 409)

    const brief = await deps.deps.db.contentBrief.findUniqueOrThrow({ where: { id } })
    return c.json(contracts.content.contentBriefSchema.parse(serializeBrief(brief)))
  })

  routes.post('/items', deps.requireAuth, deps.requireEditor, async (c) => {
    const body = (await c.req.json()) as { briefId?: string; slug?: string }
    if (!contracts.common.idSchema.safeParse(body?.briefId).success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'briefId is required' } }, 400)
    }

    const item = await createItem(deps.deps, { briefId: body.briefId!, slug: body.slug })
    if (!item) return c.json({ error: { code: 'CONFLICT', message: 'Brief is not approved' } }, 409)

    return c.json(contracts.content.contentItemSchema.parse(serializeItem(item)), 201)
  })

  routes.get('/items', deps.requireAuth, async (c) => {
    const items = await listItems(deps.deps)
    return c.json({
      items: items.map((item) => ({
        ...contracts.content.contentItemSchema.parse(serializeItem(item)),
        revisions: item.revisions.map(serializeRevision),
      })),
    })
  })

  routes.get('/items/:id', deps.requireAuth, async (c) => {
    const item = await getItem(deps.deps, c.req.param('id'))
    if (!item) return c.json({ error: { code: 'NOT_FOUND', message: 'Item not found' } }, 404)

    return c.json({
      ...contracts.content.contentItemSchema.parse(serializeItem(item)),
      revisions: item.revisions.map(serializeRevision),
    })
  })

  routes.post('/items/:id/revisions', deps.requireAuth, deps.requireEditor, async (c) => {
    const principal = c.get('principal')
    const parsed = contracts.content.createContentRevisionSchema.safeParse(await c.req.json())
    if (!parsed.success || parsed.data.contentItemId !== c.req.param('id')) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid revision payload' } }, 400)
    }

    const revision = await createRevision(deps.deps, {
      contentItemId: parsed.data.contentItemId,
      bodyMarkdown: parsed.data.bodyMarkdown,
      metaTitle: parsed.data.metaTitle,
      metaDescription: parsed.data.metaDescription,
      authorId: principal.userId,
    })
    if (!revision) return c.json({ error: { code: 'NOT_FOUND', message: 'Item not found' } }, 404)

    return c.json(contracts.content.contentRevisionSchema.parse(serializeRevision(revision)), 201)
  })

  return routes
}
