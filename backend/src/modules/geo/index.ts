import { Hono } from 'hono'
import type { Db } from '../../db'
import type { AuthModule } from '../auth'
import { createGeoRoutes } from './transport/routes'

export interface GeoModuleDeps {
  db: Db
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface GeoModule {
  routes: Hono
}

/**
 * The GEO inventory (docs/GEO.md): questions people ask, triaged by a human.
 * Visibility snapshots (unit 3) and answer assets (unit 4) join this context
 * in later units.
 */
export function createGeoModule(deps: GeoModuleDeps): GeoModule {
  const routes = createGeoRoutes({
    db: deps.db,
    requireAuth: deps.auth.requireAuth,
    requireEditor: deps.auth.requireRole('admin', 'editor'),
  })

  return { routes }
}
