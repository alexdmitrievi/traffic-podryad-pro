import { Hono } from 'hono'
import type { Db } from '../../db'
import type { AuthModule } from '../auth'
import { createEvidenceRoutes } from './transport/routes'

export interface EvidenceModuleDeps {
  db: Db
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface EvidenceModule {
  routes: Hono
}

/**
 * The evidence registry: sources a human checked, claims extracted from them and
 * citations pinpointing where each claim is supported (docs/GEO.md). Content is
 * allowed to use only verified, non-superseded claims — the pipeline integration
 * consumes this module in a later GEO unit.
 */
export function createEvidenceModule(deps: EvidenceModuleDeps): EvidenceModule {
  const routes = createEvidenceRoutes({
    db: deps.db,
    requireAuth: deps.auth.requireAuth,
    requireEditor: deps.auth.requireRole('admin', 'editor'),
  })

  return { routes }
}

export { isUsableClaim } from './domain/evidence'
