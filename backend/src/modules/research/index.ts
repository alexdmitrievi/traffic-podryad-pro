import { Hono } from 'hono'
import type { Db } from '../../db'
import type { KeywordSourcePort } from '../../providers/keywords/port'
import type { AuthModule } from '../auth'
import { createResearchRoutes } from './transport/routes'

export interface ResearchModuleDeps {
  db: Db
  keywordSource: KeywordSourcePort
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface ResearchModule {
  routes: Hono
}

export function createResearchModule(deps: ResearchModuleDeps): ResearchModule {
  const routes = createResearchRoutes({
    db: deps.db,
    keywordSource: deps.keywordSource,
    requireAuth: deps.auth.requireAuth,
    requireEditor: deps.auth.requireRole('admin', 'editor'),
  })

  return { routes }
}
