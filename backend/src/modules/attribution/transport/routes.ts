import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { MiddlewareHandler } from 'hono'
import type { AuthMiddleware } from '../../auth'
import type { AttributionDeps } from '../application/attribution'
import { attributionChain, recordTouch } from '../application/attribution'

export interface AttributionRoutesDeps {
  deps: AttributionDeps
  rateLimit: MiddlewareHandler
  requireAuth: AuthMiddleware
}

export function createAttributionRoutes(deps: AttributionRoutesDeps): { publicRoutes: Hono; routes: Hono } {
  const publicRoutes = new Hono()
  const routes = new Hono()

  // Public: the site script records touches before anyone becomes a lead.
  publicRoutes.post('/touches', deps.rateLimit, async (c) => {
    const parsed = contracts.attribution.recordTouchRequestSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid touch payload' } }, 400)
    }

    await recordTouch(deps.deps, {
      visitorId: parsed.data.visitorId,
      path: parsed.data.path,
      referrer: parsed.data.referrer ?? null,
      contentItemId: parsed.data.contentItemId ?? null,
      utmSource: parsed.data.utmSource ?? null,
      utmMedium: parsed.data.utmMedium ?? null,
      utmCampaign: parsed.data.utmCampaign ?? null,
      utmContent: parsed.data.utmContent ?? null,
      utmTerm: parsed.data.utmTerm ?? null,
    })

    return c.json(contracts.attribution.recordTouchResponseSchema.parse({ recorded: true }))
  })

  routes.get('/leads/:id/attribution', deps.requireAuth, async (c) => {
    const chain = await attributionChain(deps.deps, c.req.param('id'))
    if (!chain) return c.json({ error: { code: 'NOT_FOUND', message: 'Lead not found' } }, 404)

    return c.json(contracts.attribution.attributionChainSchema.parse(chain))
  })

  return { publicRoutes, routes }
}
