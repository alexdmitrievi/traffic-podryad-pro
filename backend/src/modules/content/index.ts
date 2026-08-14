import { Hono } from 'hono'
import type { Db } from '../../db'
import type { Outbox } from '../../outbox/outbox-service'
import type { InstrumentedLlmPort } from '../../providers/llm/instrumentation'
import type { AuthModule } from '../auth'
import { createContentRoutes } from './transport/routes'
import { getRevision, runBriefGeneration, runDraftGeneration } from './application/content'

export interface ContentModuleDeps {
  db: Db
  llm: InstrumentedLlmPort
  outbox: Outbox
  auth: Pick<AuthModule, 'requireAuth' | 'requireRole'>
}

export interface ContentModule {
  routes: Hono
  /** Worker task handlers: registered in runtime's drain registry. */
  taskHandlers: Record<string, (payload: unknown) => Promise<void>>
  /** The approvals hash provider for content revisions. */
  revisionHash: (revisionId: string) => Promise<string | null>
}

export function createContentModule(deps: ContentModuleDeps): ContentModule {
  const depsFull = { db: deps.db, llm: deps.llm, outbox: deps.outbox }

  const routes = createContentRoutes({
    deps: depsFull,
    requireAuth: deps.auth.requireAuth,
    requireEditor: deps.auth.requireRole('admin', 'editor'),
  })

  return {
    routes,
    taskHandlers: {
      'brief.generate': async (payload) =>
        runBriefGeneration(depsFull, payload as { briefId: string }),
      'draft.generate': async (payload) =>
        runDraftGeneration(depsFull, payload as { contentItemId: string }),
    },
    revisionHash: async (revisionId) => {
      const revision = await getRevision(depsFull, revisionId)
      return revision?.contentHash ?? null
    },
  }
}
