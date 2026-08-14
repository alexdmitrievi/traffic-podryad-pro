import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { Db } from '../../../db'
import type { AuthMiddleware } from '../../auth'
import {
  GeoQueryNotFoundError,
  GeoQueryReasonRequiredError,
  GeoQueryTransitionError,
  createGeoQuery,
  listGeoQueries,
  updateGeoQuery,
} from '../application/geo'

export interface GeoRoutesDeps {
  db: Db
  requireAuth: AuthMiddleware
  requireEditor: AuthMiddleware
}

export function createGeoRoutes(deps: GeoRoutesDeps): Hono {
  const routes = new Hono()
  const depsFull = { db: deps.db }

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

  return routes
}
