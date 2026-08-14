import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { AuthMiddleware } from '../../auth'
import type { ServiceRequestsDeps } from '../application/service-requests'
import {
  approvePlan,
  createPlan,
  createRequest,
  decomposePackage,
  transition,
} from '../application/service-requests'

export interface ServiceRequestsRoutesDeps {
  deps: ServiceRequestsDeps
  requireAuth: AuthMiddleware
  requireEditor: AuthMiddleware
  requireAdmin: AuthMiddleware
}

const serialize = (request: object) => {
  const record = request as Record<string, unknown>
  return {
    ...record,
    deadlineHint:
      record.deadlineHint instanceof Date ? record.deadlineHint.toISOString() : null,
    createdAt: (record.createdAt as Date).toISOString(),
    updatedAt: (record.updatedAt as Date).toISOString(),
  }
}

export function createServiceRequestsRoutes(deps: ServiceRequestsRoutesDeps): Hono {
  const routes = new Hono()

  routes.post('/', deps.requireAuth, deps.requireEditor, async (c) => {
    const principal = c.get('principal')
    const parsed = contracts.serviceRequests.createServiceRequestSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request payload' } }, 400)
    }

    const request = await createRequest(deps.deps, {
      serviceLine: parsed.data.serviceLine,
      verticalId: parsed.data.verticalId,
      title: parsed.data.title,
      objective: parsed.data.objective,
      targetRegionIds: parsed.data.targetRegionIds,
      locale: parsed.data.locale,
      requestedById: principal.userId,
    })
    return c.json(contracts.serviceRequests.serviceRequestSchema.parse(serialize(request)), 201)
  })

  routes.get('/', deps.requireAuth, async (c) => {
    const workspace = await deps.deps.db.workspace.findFirstOrThrow()
    const requests = await deps.deps.db.serviceRequest.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'asc' },
    })
    return c.json({
      requests: requests.map((request) => contracts.serviceRequests.serviceRequestSchema.parse(serialize(request))),
    })
  })

  routes.get('/:id', deps.requireAuth, async (c) => {
    const id = c.req.param('id')
    const request = await deps.deps.db.serviceRequest.findUnique({
      where: { id },
      include: { events: { orderBy: { occurredAt: 'asc' } }, plans: { orderBy: { version: 'desc' } } },
    })
    if (!request) return c.json({ error: { code: 'NOT_FOUND', message: 'Request not found' } }, 404)

    return c.json({
      ...contracts.serviceRequests.serviceRequestSchema.parse(serialize(request)),
      events: request.events.map((event) => ({
        id: event.id,
        requestId: event.requestId,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        reason: event.reason,
        actorId: event.actorId,
        occurredAt: event.occurredAt.toISOString(),
      })),
      plans: request.plans.map((plan) => ({
        id: plan.id,
        requestId: plan.requestId,
        version: plan.version,
        planKind: plan.planKind,
        content: plan.content,
        contentHash: plan.contentHash,
        authorKind: plan.authorKind,
        status: plan.status,
        createdAt: plan.createdAt.toISOString(),
      })),
    })
  })

  routes.post('/:id/status', deps.requireAuth, deps.requireAdmin, async (c) => {
    const principal = c.get('principal')
    const id = c.req.param('id')
    const parsed = contracts.serviceRequests.changeServiceRequestStatusSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid transition payload' } }, 400)
    }

    const result = await transition(deps.deps, {
      requestId: id,
      to: parsed.data.status,
      reason: parsed.data.reason ?? null,
      actorId: principal.userId,
      actorRole: principal.role,
    })

    if (!result.ok) {
      if (result.reason === 'not_executable_line') {
        return c.json(
          { error: { code: 'CAPABILITY_NOT_AVAILABLE', message: 'This service line has no delivery capability in the MVP' } },
          422,
        )
      }
      return c.json(
        { error: { code: 'SERVICE_REQUEST_INVALID_TRANSITION', message: `Transition is not allowed (${result.reason})` } },
        409,
      )
    }

    const request = await deps.deps.db.serviceRequest.findUniqueOrThrow({ where: { id } })
    return c.json(contracts.serviceRequests.serviceRequestSchema.parse(serialize(request)))
  })

  routes.post('/:id/plans', deps.requireAuth, deps.requireEditor, async (c) => {
    const principal = c.get('principal')
    const id = c.req.param('id')
    const parsed = contracts.plans.createServiceRequestPlanSchema.safeParse(await c.req.json())
    if (!parsed.success || parsed.data.requestId !== id) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid plan payload' } }, 400)
    }

    const plan = await createPlan(deps.deps, {
      requestId: id,
      content: parsed.data.content,
      authorId: principal.userId,
    })
    if (!plan) return c.json({ error: { code: 'CONFLICT', message: 'Plan kind does not match the request line' } }, 409)

    return c.json(
      {
        id: plan.id,
        requestId: plan.requestId,
        version: plan.version,
        planKind: plan.planKind,
        content: plan.content,
        contentHash: plan.contentHash,
        authorKind: plan.authorKind,
        status: plan.status,
        createdAt: plan.createdAt.toISOString(),
      },
      201,
    )
  })

  routes.post('/:id/approve-plan', deps.requireAuth, deps.requireAdmin, async (c) => {
    const principal = c.get('principal')
    const id = c.req.param('id')
    const body = (await c.req.json()) as {
      planId?: string
      contentHash?: string
      decision?: 'approved' | 'rejected'
      note?: string
    }
    if (
      !contracts.common.idSchema.safeParse(body?.planId).success ||
      !contracts.common.contentHashSchema.safeParse(body?.contentHash).success ||
      !contracts.approvals.approvalDecisionSchema.safeParse(body?.decision).success
    ) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'planId, contentHash and decision are required' } }, 400)
    }

    const result = await approvePlan(deps.deps, {
      planId: body.planId!,
      contentHash: body.contentHash!,
      decision: body.decision!,
      note: body.note ?? null,
      decidedById: principal.userId,
      actorRole: principal.role,
    })

    if (!result.ok && result.reason === 'not_found') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } }, 404)
    }
    if (!result.ok && result.reason === 'hash_mismatch') {
      return c.json(
        { error: { code: 'APPROVAL_STALE', message: 'The plan changed after the hash was computed' } },
        409,
      )
    }
    if (!result.ok) {
      return c.json(
        { error: { code: 'SERVICE_REQUEST_INVALID_TRANSITION', message: 'The request is not in planning' } },
        409,
      )
    }

    const request = await deps.deps.db.serviceRequest.findUniqueOrThrow({ where: { id } })
    return c.json(contracts.serviceRequests.serviceRequestSchema.parse(serialize(request)))
  })

  routes.post('/:id/decompose', deps.requireAuth, deps.requireAdmin, async (c) => {
    const principal = c.get('principal')
    const id = c.req.param('id')
    const created = await decomposePackage(deps.deps, { requestId: id, actorId: principal.userId })
    if (created === 0) {
      return c.json(
        { error: { code: 'SERVICE_REQUEST_INVALID_TRANSITION', message: 'Nothing to decompose: an approved complex package plan is required' } },
        409,
      )
    }
    return c.json({ childRequestsCreated: created })
  })

  return routes
}
