import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { Db } from '../../../db'
import type { AuthMiddleware } from '../../auth'
import type { ApprovalsDeps } from '../../approvals'
import {
  GeoQueryFrozenError,
  GeoQueryNotFoundError,
  GeoQueryReasonRequiredError,
  GeoQueryTransitionError,
  createGeoQuery,
  createVisibilitySnapshot,
  listGeoQueries,
  listVisibilitySnapshots,
  updateGeoQuery,
} from '../application/geo'
import {
  GeoAnswerExistsError,
  GeoAnswerNotFoundError,
  GeoClaimNotUsableError,
  GeoQueryNotPlannedError,
  approveAnswer,
  createAnswer,
  listAnswers,
  updateAnswer,
} from '../application/geo-answers'

export interface GeoRoutesDeps {
  db: Db
  approvals: ApprovalsDeps
  requireAuth: AuthMiddleware
  requireEditor: AuthMiddleware
  requireAdmin: AuthMiddleware
}

export function createGeoRoutes(deps: GeoRoutesDeps): Hono {
  const routes = new Hono()
  const depsFull = { db: deps.db }
  const answerDeps = { db: deps.db, approvals: deps.approvals }

  routes.post('/queries', deps.requireAuth, deps.requireEditor, async (c) => {
    const parsed = contracts.geoQueries.createGeoQuerySchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query payload' } }, 400)
    }

    const query = await createGeoQuery(depsFull, parsed.data)
    return c.json(contracts.geoQueries.geoQuerySchema.parse(query), 201)
  })

  routes.patch('/queries/:id', deps.requireAuth, deps.requireEditor, async (c) => {
    const id = contracts.common.idSchema.safeParse(c.req.param('id'))
    if (!id.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a UUID' } }, 400)
    }
    const parsed = contracts.geoQueries.updateGeoQuerySchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid update payload' } }, 400)
    }

    try {
      const query = await updateGeoQuery(depsFull, { queryId: id.data, ...parsed.data })
      return c.json(contracts.geoQueries.geoQuerySchema.parse(query))
    } catch (error) {
      if (error instanceof GeoQueryNotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
      }
      if (error instanceof GeoQueryTransitionError) {
        return c.json({ error: { code: 'GEO_TRANSITION_NOT_ALLOWED', message: error.message } }, 409)
      }
      if (error instanceof GeoQueryReasonRequiredError) {
        return c.json({ error: { code: 'GEO_REASON_REQUIRED', message: error.message } }, 422)
      }
      throw error
    }
  })

  routes.get('/queries', deps.requireAuth, async (c) => {
    const query = contracts.geoQueries.geoQueryListQuerySchema.safeParse({
      clusterId: c.req.query('clusterId'),
      status: c.req.query('status'),
    })
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query' } }, 400)
    }

    const queries = await listGeoQueries(depsFull, query.data)
    return c.json({ queries: queries.map((entry) => contracts.geoQueries.geoQuerySchema.parse(entry)) })
  })

  routes.post('/queries/:id/snapshots', deps.requireAuth, deps.requireEditor, async (c) => {
    const id = contracts.common.idSchema.safeParse(c.req.param('id'))
    if (!id.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a UUID' } }, 400)
    }
    const parsed = contracts.geoSnapshots.createGeoVisibilitySnapshotSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid snapshot payload' } }, 400)
    }

    try {
      const snapshot = await createVisibilitySnapshot(depsFull, { queryId: id.data, ...parsed.data })
      return c.json(contracts.geoSnapshots.geoVisibilitySnapshotSchema.parse(snapshot), 201)
    } catch (error) {
      if (error instanceof GeoQueryNotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
      }
      if (error instanceof GeoQueryFrozenError) {
        return c.json({ error: { code: 'GEO_QUERY_FROZEN', message: error.message } }, 409)
      }
      throw error
    }
  })

  routes.get('/queries/:id/snapshots', deps.requireAuth, async (c) => {
    const id = contracts.common.idSchema.safeParse(c.req.param('id'))
    if (!id.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a UUID' } }, 400)
    }

    try {
      const snapshots = await listVisibilitySnapshots(depsFull, { queryId: id.data })
      return c.json({
        snapshots: snapshots.map((entry) => contracts.geoSnapshots.geoVisibilitySnapshotSchema.parse(entry)),
      })
    } catch (error) {
      if (error instanceof GeoQueryNotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
      }
      throw error
    }
  })

  routes.post('/queries/:id/answer', deps.requireAuth, deps.requireEditor, async (c) => {
    const id = contracts.common.idSchema.safeParse(c.req.param('id'))
    if (!id.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a UUID' } }, 400)
    }
    const parsed = contracts.geoAnswers.createGeoAnswerSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid answer payload' } }, 400)
    }

    try {
      const answer = await createAnswer(answerDeps, { queryId: id.data, ...parsed.data })
      return c.json(contracts.geoAnswers.geoAnswerSchema.parse(answer), 201)
    } catch (error) {
      if (error instanceof GeoQueryNotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
      }
      if (error instanceof GeoQueryNotPlannedError) {
        return c.json({ error: { code: 'GEO_QUERY_NOT_PLANNED', message: error.message } }, 409)
      }
      if (error instanceof GeoAnswerExistsError) {
        return c.json({ error: { code: 'GEO_ANSWER_EXISTS', message: error.message } }, 409)
      }
      if (error instanceof GeoClaimNotUsableError) {
        return c.json({ error: { code: 'GEO_CLAIM_NOT_USABLE', message: error.message } }, 422)
      }
      throw error
    }
  })

  routes.get('/answers', deps.requireAuth, async (c) => {
    const query = contracts.geoAnswers.geoAnswerListQuerySchema.safeParse({
      queryId: c.req.query('queryId'),
    })
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query' } }, 400)
    }

    const answers = await listAnswers(answerDeps, query.data)
    return c.json({ answers: answers.map((entry) => contracts.geoAnswers.geoAnswerWithApprovalSchema.parse(entry)) })
  })

  routes.patch('/answers/:id', deps.requireAuth, deps.requireEditor, async (c) => {
    const id = contracts.common.idSchema.safeParse(c.req.param('id'))
    if (!id.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a UUID' } }, 400)
    }
    const parsed = contracts.geoAnswers.updateGeoAnswerSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid update payload' } }, 400)
    }

    try {
      const answer = await updateAnswer(answerDeps, { answerId: id.data, ...parsed.data })
      return c.json(contracts.geoAnswers.geoAnswerSchema.parse(answer))
    } catch (error) {
      if (error instanceof GeoAnswerNotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
      }
      if (error instanceof GeoClaimNotUsableError) {
        return c.json({ error: { code: 'GEO_CLAIM_NOT_USABLE', message: error.message } }, 422)
      }
      throw error
    }
  })

  routes.post('/answers/:id/approve', deps.requireAuth, deps.requireAdmin, async (c) => {
    const principal = c.get('principal')
    const id = contracts.common.idSchema.safeParse(c.req.param('id'))
    if (!id.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a UUID' } }, 400)
    }
    const parsed = contracts.geoAnswers.approveGeoAnswerSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid approval payload' } }, 400)
    }

    try {
      const result = await approveAnswer(answerDeps, {
        answerId: id.data,
        contentHash: parsed.data.contentHash,
        note: parsed.data.note ?? null,
        decidedById: principal.userId,
      })
      if (!result.ok) {
        return c.json(
          { error: { code: 'APPROVAL_STALE', message: 'The answer changed after the hash was computed; re-approve the current content' } },
          409,
        )
      }
      return c.json({ approvalId: result.approvalId }, 201)
    } catch (error) {
      if (error instanceof GeoAnswerNotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
      }
      if (error instanceof GeoClaimNotUsableError) {
        return c.json({ error: { code: 'GEO_CLAIM_NOT_USABLE', message: error.message } }, 422)
      }
      throw error
    }
  })

  return routes
}
