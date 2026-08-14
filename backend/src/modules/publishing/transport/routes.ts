import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { AuthMiddleware } from '../../auth'
import type { PublishingDeps } from '../application/publishing'
import { listPublications, publishRevision } from '../application/publishing'

export interface PublishingRoutesDeps {
  deps: PublishingDeps
  requireAuth: AuthMiddleware
  requireEditor: AuthMiddleware
}

export function createPublishingRoutes(deps: PublishingRoutesDeps): Hono {
  const routes = new Hono()

  routes.post('/publications', deps.requireAuth, deps.requireEditor, async (c) => {
    const principal = c.get('principal')
    const parsed = contracts.content.publishRequestSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid publish payload' } }, 400)
    }

    const result = await publishRevision(deps.deps, {
      contentItemId: parsed.data.contentItemId,
      revisionId: parsed.data.revisionId,
      actorId: principal.userId,
    })

    if (!result.ok) {
      if (result.reason === 'revision_not_found') {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Revision not found for this item' } }, 404)
      }
      if (result.reason === 'approval_required') {
        return c.json(
          { error: { code: 'APPROVAL_REQUIRED', message: 'This revision has no approval; publication is blocked' } },
          409,
        )
      }
      return c.json(
        { error: { code: 'APPROVAL_STALE', message: 'The approved content changed; re-approve the current revision' } },
        409,
      )
    }

    const publication = await deps.deps.db.publication.findUniqueOrThrow({ where: { id: result.publicationId } })
    return c.json(
      contracts.content.publicationSchema.parse({
        ...publication,
        publicUrl: publication.publicUrl,
        publishedAt: publication.publishedAt?.toISOString() ?? null,
        createdAt: publication.createdAt.toISOString(),
      }),
      201,
    )
  })

  routes.get('/publications', deps.requireAuth, async (c) => {
    const publications = await listPublications(deps.deps)
    return c.json({
      publications: publications.map((publication) =>
        contracts.content.publicationSchema.parse({
          ...publication,
          publishedAt: publication.publishedAt?.toISOString() ?? null,
          createdAt: publication.createdAt.toISOString(),
        }),
      ),
    })
  })

  return routes
}
