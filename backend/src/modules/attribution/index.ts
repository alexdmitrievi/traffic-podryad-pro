import { Hono } from 'hono'
import type { Db } from '../../db'
import type { MiddlewareHandler } from 'hono'
import type { AuthModule } from '../auth'
import { createAttributionRoutes } from './transport/routes'

export interface AttributionModuleDeps {
  db: Db
  rateLimit: MiddlewareHandler
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface AttributionModule {
  /** The public touch endpoint, mounted under /api/public. */
  publicRoutes: Hono
  /** The authenticated chain endpoint, mounted under /api/attribution. */
  routes: Hono
}

export function createAttributionModule(deps: AttributionModuleDeps): AttributionModule {
  const created = createAttributionRoutes({
    deps: { db: deps.db },
    rateLimit: deps.rateLimit,
    requireAuth: deps.auth.requireAuth,
  })

  return { publicRoutes: created.publicRoutes, routes: created.routes }
}
