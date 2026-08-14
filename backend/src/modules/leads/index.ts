import { Hono } from 'hono'
import type { Db } from '../../db'
import type { MiddlewareHandler } from 'hono'
import type { AuthModule } from '../auth'
import { createLeadsRoutes } from './transport/routes'

export interface LeadsModuleDeps {
  db: Db
  rateLimit: MiddlewareHandler
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface LeadsModule {
  /** The public CTA submission, mounted under /api/public. */
  publicRoutes: Hono
  /** The authenticated list, mounted under /api. */
  routes: Hono
}

export function createLeadsModule(deps: LeadsModuleDeps): LeadsModule {
  const created = createLeadsRoutes({
    deps: { db: deps.db },
    rateLimit: deps.rateLimit,
    requireAuth: deps.auth.requireAuth,
  })

  return { publicRoutes: created.publicRoutes, routes: created.routes }
}
