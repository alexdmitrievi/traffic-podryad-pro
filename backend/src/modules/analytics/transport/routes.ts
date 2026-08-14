import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { AuthMiddleware } from '../../auth'
import type { AnalyticsDeps } from '../application/analytics'
import { funnelSummary } from '../application/analytics'

export interface AnalyticsRoutesDeps {
  deps: AnalyticsDeps
  requireAuth: AuthMiddleware
}

export function createAnalyticsRoutes(deps: AnalyticsRoutesDeps): Hono {
  const routes = new Hono()

  routes.get('/funnel', deps.requireAuth, async (c) => {
    const summary = await funnelSummary(deps.deps)
    return c.json(contracts.attribution.funnelSummarySchema.parse(summary))
  })

  return routes
}
