import { Hono } from 'hono'
import type { Db } from '../../db'
import type { AuthModule } from '../auth'
import type { ApprovalsDeps } from '../approvals'
import { createServiceRequestsRoutes } from './transport/routes'

export interface ServiceRequestsModuleDeps {
  db: Db
  approvals: ApprovalsDeps
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface ServiceRequestsModule {
  routes: Hono
}

export function createServiceRequestsModule(deps: ServiceRequestsModuleDeps): ServiceRequestsModule {
  const depsFull = { db: deps.db, approvals: deps.approvals }

  const routes = createServiceRequestsRoutes({
    deps: depsFull,
    requireAuth: deps.auth.requireAuth,
    requireEditor: deps.auth.requireRole('admin', 'editor'),
    requireAdmin: deps.auth.requireRole('admin'),
  })

  return { routes }
}
