import { Hono } from 'hono'
import type { Db } from '../../db'
import type { AuthModule } from '../auth'
import type { ApprovalsDeps } from '../approvals'
import { createGeoRoutes } from './transport/routes'

export interface GeoModuleDeps {
  db: Db
  approvals: ApprovalsDeps
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface GeoModule {
  routes: Hono
}

/**
 * The GEO context (docs/GEO.md): the question inventory, manual visibility snapshots
 * and answer assets approved through the shared gate. Approvals are reused, not
 * duplicated: an answer asset is approved exactly like a plan or a revision.
 */
export function createGeoModule(deps: GeoModuleDeps): GeoModule {
  const routes = createGeoRoutes({
    db: deps.db,
    approvals: deps.approvals,
    requireAuth: deps.auth.requireAuth,
    requireEditor: deps.auth.requireRole('admin', 'editor'),
    requireAdmin: deps.auth.requireRole('admin'),
  })

  return { routes }
}
