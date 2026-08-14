import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { MiddlewareHandler } from 'hono'
import type { LeadsDeps } from '../application/leads'
import { listLeads, submitLead } from '../application/leads'
import type { AuthMiddleware } from '../../auth'

export interface LeadsRoutesDeps {
  deps: LeadsDeps
  rateLimit: MiddlewareHandler
  requireAuth: AuthMiddleware
}

export function createLeadsRoutes(deps: LeadsRoutesDeps): { publicRoutes: Hono; routes: Hono } {
  const publicRoutes = new Hono()
  const routes = new Hono()

  // Public: the CTA form. Consent is enforced server-side by the contract schema; a
  // filled honeypot is dropped quietly — the bot gets the same "accepted" as anyone.
  publicRoutes.post('/leads', deps.rateLimit, async (c) => {
    const raw = (await c.req.json()) as { website?: string } & Record<string, unknown>
    if (raw?.website !== undefined && raw.website !== '') {
      return c.json({ accepted: true })
    }

    const parsed = contracts.leads.submitLeadRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid lead payload; consent is mandatory and verified on the server',
          },
        },
        400,
      )
    }

    const data = parsed.data
    const result = await submitLead(deps.deps, {
      productId: data.productId ?? null,
      volume: data.volume ?? null,
      volumeUnit: data.volumeUnit ?? null,
      deliveryRegionId: data.deliveryRegionId ?? null,
      deliveryBasisId: data.deliveryBasisId ?? null,
      companyName: data.companyName ?? null,
      inn: data.inn ?? null,
      contactName: data.contactName,
      phone: data.phone ?? null,
      email: data.email ?? null,
      message: data.message ?? null,
      visitorId: data.visitorId ?? null,
      landingPath: data.landingPath ?? null,
      contentItemId: data.contentItemId ?? null,
      utmSource: data.utmSource ?? null,
      utmMedium: data.utmMedium ?? null,
      utmCampaign: data.utmCampaign ?? null,
      utmContent: data.utmContent ?? null,
      utmTerm: data.utmTerm ?? null,
      consentTextVersion: data.consentTextVersion,
      privacyPolicyVersion: data.privacyPolicyVersion,
    })

    return c.json(contracts.leads.submitLeadResponseSchema.parse({ accepted: true }))
  })

  routes.get('/leads', deps.requireAuth, async (c) => {
    const leads = await listLeads(deps.deps)
    return c.json({
      leads: leads.map((lead) => ({
        id: lead.id,
        productId: lead.productId,
        volume: lead.volume === null ? null : Number(lead.volume),
        volumeUnit: lead.volumeUnit,
        deliveryRegionId: lead.deliveryRegionId,
        companyName: lead.companyName,
        inn: lead.inn,
        contactName: lead.contactName,
        phone: lead.phone,
        email: lead.email,
        landingPath: lead.landingPath,
        contentItemId: lead.contentItemId,
        utmSource: lead.utmSource,
        utmMedium: lead.utmMedium,
        utmCampaign: lead.utmCampaign,
        utmContent: lead.utmContent,
        utmTerm: lead.utmTerm,
        consentAt: lead.consentAt.toISOString(),
        consentTextVersion: lead.consentTextVersion,
        privacyPolicyVersion: lead.privacyPolicyVersion,
        status: lead.status,
        createdAt: lead.createdAt.toISOString(),
      })),
    })
  })

  return { publicRoutes, routes }
}
