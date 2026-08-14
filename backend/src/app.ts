/**
 * The Hono application: health routes only, for unit 4a.
 *
 * Health contract (docs/DEPLOYMENT.md section 4):
 *   - `/health`      fast, no external dependencies;
 *   - `/health/live` process liveness; must NOT touch the database — a temporarily
 *                    unreachable database must not trigger a restart that does not fix it;
 *   - `/health/ready` readiness: the database answers and migrations are applied.
 *
 * The probe is injected as an interface so the "live does not touch the database" property
 * is provable in a unit test: a probe whose methods throw on any call still has to yield
 * a 200 from /health and /health/live.
 */

import { Hono } from 'hono'
import { createCorsMiddleware } from './cors'
import type { CorsConfig } from './cors'
import { createOriginCheckMiddleware } from './origin-check'

export interface HealthProbe {
  ping(): Promise<boolean>
  migrationsApplied(): Promise<boolean>
}

export interface AppDeps {
  probe: HealthProbe
  cors: CorsConfig
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  // Applied before any route so both middlewares cover every endpoint registered later,
  // including the ones modules mount at runtime.
  app.use('*', createCorsMiddleware(deps.cors))
  app.use('*', createOriginCheckMiddleware(deps.cors))

  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.get('/health/live', (c) => c.json({ status: 'alive' }))

  app.get('/health/ready', async (c) => {
    try {
      const reachable = await deps.probe.ping()
      if (!reachable) {
        return c.json({ status: 'not_ready', reason: 'database_unreachable' }, 503)
      }
      const migrated = await deps.probe.migrationsApplied()
      if (!migrated) {
        return c.json({ status: 'not_ready', reason: 'migrations_pending' }, 503)
      }
      return c.json({ status: 'ready' })
    } catch {
      return c.json({ status: 'not_ready', reason: 'database_unreachable' }, 503)
    }
  })

  return app
}
