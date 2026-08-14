import { Hono } from 'hono'
import { contracts } from '@traffic/contracts'
import type { ApprovalsDeps } from '../application/approvals'
import { decide, state } from '../application/approvals'
import type { AuthMiddleware } from '../../auth'

export interface ApprovalsRoutesDeps {
  deps: ApprovalsDeps
  requireAuth: AuthMiddleware
  requireAdmin: AuthMiddleware
}

export function createApprovalsRoutes(deps: ApprovalsRoutesDeps): Hono {
  const routes = new Hono()

  routes.post('/', deps.requireAuth, deps.requireAdmin, async (c) => {
    const principal = c.get('principal')
    const parsed = contracts.approvals.createApprovalSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid approval payload' } }, 400)
    }

    const result = await decide(deps.deps, {
      subjectType: parsed.data.subjectType,
      subjectId: parsed.data.subjectId,
      contentHash: parsed.data.contentHash,
      decision: parsed.data.decision,
      note: parsed.data.note ?? null,
      decidedById: principal.userId,
    })

    if (!result.ok) {
      if (result.reason === 'subject_not_found') {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Approval subject not found' } }, 404)
      }
      return c.json(
        {
          error: {
            code: 'APPROVAL_STALE',
            message: 'The subject changed after the hash was computed; re-approve the current content',
          },
        },
        409,
      )
    }

    const current = await state(deps.deps, {
      subjectType: parsed.data.subjectType,
      subjectId: parsed.data.subjectId,
    })
    return c.json(
      {
        approvalId: result.approvalId,
        isApproved: current.isApproved,
      },
      201,
    )
  })

  routes.get('/state', deps.requireAuth, async (c) => {
    const subjectType = c.req.query('subjectType')
    const subjectId = c.req.query('subjectId')
    if (
      !contracts.approvals.approvalSubjectTypeSchema.safeParse(subjectType).success ||
      !contracts.common.idSchema.safeParse(subjectId).success
    ) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'subjectType and subjectId are required' } }, 400)
    }

    const current = await state(deps.deps, {
      subjectType: subjectType as 'service_request_plan' | 'content_revision' | 'publication',
      subjectId: subjectId as string,
    })

    return c.json({
      subjectType,
      subjectId,
      currentHash: current.currentHash,
      approval: current.approval
        ? {
            ...current.approval,
            decidedAt: current.approval.decidedAt.toISOString(),
          }
        : null,
      isApproved: current.isApproved,
      reason: current.reason,
    })
  })

  return routes
}
