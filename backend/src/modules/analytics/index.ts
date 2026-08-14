import { Hono } from 'hono'
import type { Db } from '../../db'
import type { AuthModule } from '../auth'
import { createAnalyticsRoutes } from './transport/routes'

export interface AnalyticsModuleDeps {
  db: Db
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface AnalyticsModule {
  routes: Hono
}

export function createAnalyticsModule(deps: AnalyticsModuleDeps): AnalyticsModule {
  const routes = createAnalyticsRoutes({
    deps: { db: deps.db },
    requireAuth: deps.auth.requireAuth,
  })

  return { routes }
}
