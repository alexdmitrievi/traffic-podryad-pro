import { Hono } from 'hono'
import type { Db } from '../../db'
import type { AuthModule } from '../auth'
import type { SubjectHashProvider } from './application/approvals'
import { createApprovalsRoutes } from './transport/routes'

export interface ApprovalsModuleDeps {
  db: Db
  hashProvider: SubjectHashProvider
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface ApprovalsModule {
  routes: Hono
}

export function createApprovalsModule(deps: ApprovalsModuleDeps): ApprovalsModule {
  const depsFull = { db: deps.db, hashProvider: deps.hashProvider }

  const routes = createApprovalsRoutes({
    deps: depsFull,
    requireAuth: deps.auth.requireAuth,
    requireAdmin: deps.auth.requireRole('admin'),
  })

  return { routes }
}

export { decide, isApproved, state } from './application/approvals'
export type { ApprovalsDeps, DecideResult, SubjectHashProvider } from './application/approvals'
