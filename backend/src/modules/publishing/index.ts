import { Hono } from 'hono'
import type { Db } from '../../db'
import type { Outbox } from '../../outbox/outbox-service'
import type { PublishingPort } from '../../providers/publishing/port'
import type { AuthModule } from '../auth'
import { createPublishingRoutes } from './transport/routes'
import { runPublication } from './application/publishing'

export interface PublishingModuleDeps {
  db: Db
  outbox: Outbox
  publishing: PublishingPort
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface PublishingModule {
  routes: Hono
  taskHandlers: Record<string, (payload: unknown) => Promise<void>>
}

export function createPublishingModule(deps: PublishingModuleDeps): PublishingModule {
  const depsFull = { db: deps.db, outbox: deps.outbox, publishing: deps.publishing }

  const routes = createPublishingRoutes({
    deps: depsFull,
    requireAuth: deps.auth.requireAuth,
    requireEditor: deps.auth.requireRole('admin', 'editor'),
  })

  return {
    routes,
    taskHandlers: {
      'publication.perform': async (payload) =>
        runPublication(depsFull, payload as { publicationId: string }),
    },
  }
}
