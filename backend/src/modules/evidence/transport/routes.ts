import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { Db } from '../../../db'
import type { AuthMiddleware } from '../../auth'
import {
  ClaimDuplicateError,
  ClaimNotFoundError,
  ClaimSupersededError,
  EvidenceSourceNotFoundError,
  createClaim,
  createSource,
  listClaims,
  listSources,
  serializeSource,
  supersedeClaim,
  verifyClaim,
  verifySource,
} from '../application/evidence'

export interface EvidenceRoutesDeps {
  db: Db
  requireAuth: AuthMiddleware
  requireEditor: AuthMiddleware
}

export function createEvidenceRoutes(deps: EvidenceRoutesDeps): Hono {
  const routes = new Hono()
  const depsFull = { db: deps.db }

  routes.post('/sources', deps.requireAuth, deps.requireEditor, async (c) => {
    const parsed = contracts.evidence.createEvidenceSourceSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid source payload' } }, 400)
    }

    const source = await createSource(depsFull, parsed.data)
    return c.json(contracts.evidence.evidenceSourceSchema.parse(source), 201)
  })

  routes.post('/sources/:id/verify', deps.requireAuth, deps.requireEditor, async (c) => {
    const principal = c.get('principal')
    const id = contracts.common.idSchema.safeParse(c.req.param('id'))
    if (!id.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a UUID' } }, 400)
    }

    try {
      const source = await verifySource(depsFull, { sourceId: id.data, actorId: principal.userId })
      return c.json(
        contracts.evidence.evidenceSourceSchema.parse({
          ...serializeSource(source, 0),
          claimCount: 0,
        }),
      )
    } catch (error) {
      if (error instanceof EvidenceSourceNotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
      }
      throw error
    }
  })

  routes.get('/sources', deps.requireAuth, async (c) => {
    const sources = await listSources(depsFull)
    return c.json({ sources: sources.map((source) => contracts.evidence.evidenceSourceSchema.parse(source)) })
  })

  routes.post('/claims', deps.requireAuth, deps.requireEditor, async (c) => {
    const parsed = contracts.evidence.createClaimSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid claim payload' } }, 400)
    }

    try {
      const claim = await createClaim(depsFull, parsed.data)
      return c.json(contracts.evidence.claimSchema.parse(claim), 201)
    } catch (error) {
      if (error instanceof EvidenceSourceNotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
      }
      if (error instanceof ClaimDuplicateError) {
        return c.json({ error: { code: 'CLAIM_DUPLICATE', message: error.message } }, 409)
      }
      throw error
    }
  })

  routes.post('/claims/:id/verify', deps.requireAuth, deps.requireEditor, async (c) => {
    const principal = c.get('principal')
    const id = contracts.common.idSchema.safeParse(c.req.param('id'))
    if (!id.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a UUID' } }, 400)
    }

    try {
      const claim = await verifyClaim(depsFull, { claimId: id.data, actorId: principal.userId })
      return c.json(contracts.evidence.claimSchema.parse(claim))
    } catch (error) {
      if (error instanceof ClaimNotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
      }
      if (error instanceof ClaimSupersededError) {
        return c.json({ error: { code: 'CLAIM_SUPERSEDED', message: error.message } }, 409)
      }
      throw error
    }
  })

  routes.post('/claims/:id/supersede', deps.requireAuth, deps.requireEditor, async (c) => {
    const principal = c.get('principal')
    const id = contracts.common.idSchema.safeParse(c.req.param('id'))
    if (!id.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a UUID' } }, 400)
    }
    const parsed = contracts.evidence.supersedeClaimSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid supersede payload' } }, 400)
    }

    try {
      const claim = await supersedeClaim(depsFull, {
        claimId: id.data,
        actorId: principal.userId,
        patch: parsed.data,
      })
      return c.json(contracts.evidence.claimSchema.parse(claim), 201)
    } catch (error) {
      if (error instanceof ClaimNotFoundError || error instanceof EvidenceSourceNotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404)
      }
      if (error instanceof ClaimSupersededError) {
        return c.json({ error: { code: 'CLAIM_SUPERSEDED', message: error.message } }, 409)
      }
      if (error instanceof ClaimDuplicateError) {
        return c.json({ error: { code: 'CLAIM_DUPLICATE', message: error.message } }, 409)
      }
      throw error
    }
  })

  routes.get('/claims', deps.requireAuth, async (c) => {
    const query = contracts.evidence.claimListQuerySchema.safeParse({
      sourceId: c.req.query('sourceId'),
      status: c.req.query('status'),
    })
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query' } }, 400)
    }

    const claims = await listClaims(depsFull, query.data)
    return c.json({ claims: claims.map((claim) => contracts.evidence.claimSchema.parse(claim)) })
  })

  return routes
}
