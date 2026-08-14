import type { ServiceLine, ServiceRequestStatus } from '@traffic/contracts'
import { isExecutableServiceLine } from '@traffic/contracts'
import type { Db } from '../../../db'
import { hashCanonical } from '../../../shared/hashing'
import type { ApprovalsDeps } from '../../approvals'
import { isApproved } from '../../approvals'
import { canTransition } from '../domain/transitions'
import type { TransitionActor, TransitionResult } from '../domain/transitions'

export interface ServiceRequestsDeps {
  db: Db
  approvals: ApprovalsDeps
}

export interface PublicRequest {
  id: string
  requestNumber: string
  serviceLine: ServiceLine
  verticalId: string | null
  title: string
  objective: string
  targetRegionIds: string[]
  locale: string
  status: ServiceRequestStatus
  statusReason: string | null
  requestedById: string
  parentRequestId: string | null
  deadlineHint: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface PublicPlan {
  id: string
  requestId: string
  version: number
  planKind: string
  content: unknown
  contentHash: string
  authorKind: 'human' | 'llm'
  status: 'draft' | 'approved'
  createdAt: Date
}

function toPublicRequest(row: Record<string, unknown>): PublicRequest {
  return row as unknown as PublicRequest
}

function nextRequestNumber(year: number, count: number): string {
  return `SR-${year}-${String(count + 1).padStart(4, '0')}`
}

export async function createRequest(
  deps: ServiceRequestsDeps,
  input: {
    serviceLine: ServiceLine
    verticalId?: string
    title: string
    objective: string
    targetRegionIds?: string[]
    locale?: string
    requestedById: string
    parentRequestId?: string
    initialStatus?: ServiceRequestStatus
  },
): Promise<PublicRequest> {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  const year = new Date().getUTCFullYear()
  const count = await deps.db.serviceRequest.count({
    where: { workspaceId: workspace.id, requestNumber: { startsWith: `SR-${year}-` } },
  })
  const initialStatus = input.initialStatus ?? 'draft'

  const row = await deps.db.serviceRequest.create({
    data: {
      workspaceId: workspace.id,
      requestNumber: nextRequestNumber(year, count),
      serviceLine: input.serviceLine,
      verticalId: input.verticalId ?? null,
      title: input.title,
      objective: input.objective,
      targetRegionIds: input.targetRegionIds ?? [],
      locale: input.locale ?? 'ru',
      status: initialStatus,
      parentRequestId: input.parentRequestId ?? null,
      requestedById: input.requestedById,
      events: {
        create: {
          workspaceId: workspace.id,
          fromStatus: null,
          toStatus: initialStatus,
          reason: null,
          actorId: input.requestedById,
        },
      },
    },
  })

  return toPublicRequest(row)
}

export async function transition(
  deps: ServiceRequestsDeps,
  input: {
    requestId: string
    to: ServiceRequestStatus
    reason: string | null
    actorId: string | null
    actorRole: TransitionActor
  },
): Promise<TransitionResult> {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  const request = await deps.db.serviceRequest.findUnique({ where: { id: input.requestId } })
  if (!request) {
    return { ok: false, reason: 'invalid_transition' }
  }

  const decision = canTransition({
    from: request.status,
    to: input.to,
    actor: input.actorRole,
    line: request.serviceLine,
    reason: input.reason,
  })
  if (!decision.ok) return decision

  // The plan approval gate: planning → plan_approved requires a valid approval bound to
  // the current plan's hash (docs/SERVICE_REQUESTS.md section 5).
  if (input.to === 'plan_approved') {
    const plan = await deps.db.serviceRequestPlan.findFirst({
      where: { requestId: request.id, status: 'draft' },
      orderBy: { version: 'desc' },
    })
    if (!plan) return { ok: false, reason: 'invalid_transition' }
    const approved = await isApproved(deps.approvals, {
      subjectType: 'service_request_plan',
      subjectId: plan.id,
    })
    if (!approved) return { ok: false, reason: 'invalid_transition' }
    await deps.db.serviceRequestPlan.update({ where: { id: plan.id }, data: { status: 'approved' } })
  }

  await deps.db.$transaction(async (tx) => {
    await tx.serviceRequest.update({
      where: { id: request.id },
      data: { status: input.to, statusReason: input.reason ?? (input.to === 'cancelled' || input.to === 'rejected' || input.to === 'on_hold' ? input.reason : null) },
    })
    await tx.serviceRequestEvent.create({
      data: {
        workspaceId: workspace.id,
        requestId: request.id,
        fromStatus: request.status,
        toStatus: input.to,
        reason: input.reason,
        actorId: input.actorId,
      },
    })
  })

  // Planning-only lines terminate deliberately: after the plan is approved there is
  // nothing to deliver, and the terminal state says exactly that.
  if (
    input.to === 'plan_approved' &&
    !isExecutableServiceLine(request.serviceLine)
  ) {
    await transition(deps, {
      requestId: request.id,
      to: 'planned_awaiting_capability',
      reason: null,
      actorId: null,
      actorRole: 'system',
    })
  }

  await reconcileParent(deps, request.parentRequestId)
  return { ok: true }
}

/** A complex package reaches partially_delivered when all children are terminal. */
async function reconcileParent(deps: ServiceRequestsDeps, parentRequestId: string | null): Promise<void> {
  if (!parentRequestId) return
  const parent = await deps.db.serviceRequest.findUnique({ where: { id: parentRequestId } })
  if (!parent || parent.status === 'partially_delivered') return

  const children = await deps.db.serviceRequest.findMany({ where: { parentRequestId } })
  const terminalStatuses = ['delivered', 'planned_awaiting_capability', 'rejected', 'cancelled']
  const allTerminal = children.every((child) => terminalStatuses.includes(child.status))
  if (!allTerminal) return

  const workspace = await deps.db.workspace.findFirstOrThrow()
  await deps.db.$transaction(async (tx) => {
    await tx.serviceRequest.update({
      where: { id: parent.id },
      data: { status: 'partially_delivered' },
    })
    await tx.serviceRequestEvent.create({
      data: {
        workspaceId: workspace.id,
        requestId: parent.id,
        fromStatus: parent.status,
        toStatus: 'partially_delivered',
        reason: 'all child requests reached a terminal state',
        actorId: null,
      },
    })
  })
}

export async function createPlan(
  deps: ServiceRequestsDeps,
  input: { requestId: string; content: unknown; authorId: string },
): Promise<PublicPlan | null> {
  const request = await deps.db.serviceRequest.findUnique({ where: { id: input.requestId } })
  if (!request) return null

  const content = input.content as { kind: string }
  if (content.kind !== request.serviceLine) return null

  const last = await deps.db.serviceRequestPlan.findFirst({
    where: { requestId: request.id },
    orderBy: { version: 'desc' },
  })

  const workspace = await deps.db.workspace.findFirstOrThrow()
  const row = await deps.db.serviceRequestPlan.create({
    data: {
      workspaceId: workspace.id,
      requestId: request.id,
      version: (last?.version ?? 0) + 1,
      planKind: request.serviceLine,
      content: input.content as object,
      contentHash: hashCanonical(input.content),
      authorKind: 'human',
      authorId: input.authorId,
      status: 'draft',
    },
  })

  return row as unknown as PublicPlan
}

/** Plan approval in one step: decide + move the request forward. */
export async function approvePlan(
  deps: ServiceRequestsDeps,
  input: {
    planId: string
    contentHash: string
    decision: 'approved' | 'rejected'
    note: string | null
    decidedById: string
    actorRole: TransitionActor
  },
): Promise<{ ok: boolean; reason?: 'not_found' | 'hash_mismatch' | 'invalid_transition' }> {
  const plan = await deps.db.serviceRequestPlan.findUnique({ where: { id: input.planId } })
  if (!plan) return { ok: false, reason: 'not_found' }
  if (plan.contentHash !== input.contentHash) return { ok: false, reason: 'hash_mismatch' }

  if (input.decision === 'rejected') {
    // A rejection is recorded against the exact hash and changes nothing about the plan.
    const rejected = await deps.db.approval.findFirst({
      where: { subjectType: 'service_request_plan', subjectId: plan.id },
      orderBy: { decidedAt: 'desc' },
    })
    if (!rejected || rejected.decision !== 'rejected') {
      const workspace = await deps.db.workspace.findFirstOrThrow()
      await deps.db.approval.create({
        data: {
          workspaceId: workspace.id,
          subjectType: 'service_request_plan',
          subjectId: plan.id,
          contentHash: input.contentHash,
          decision: 'rejected',
          decidedById: input.decidedById,
          note: input.note,
        },
      })
    }
    return { ok: true }
  }

  const workspace = await deps.db.workspace.findFirstOrThrow()
  await deps.db.approval.create({
    data: {
      workspaceId: workspace.id,
      subjectType: 'service_request_plan',
      subjectId: plan.id,
      contentHash: input.contentHash,
      decision: 'approved',
      decidedById: input.decidedById,
      note: input.note,
    },
  })

  const request = await deps.db.serviceRequest.findUnique({ where: { id: plan.requestId } })
  if (!request) return { ok: false, reason: 'not_found' }
  if (request.status !== 'planning') return { ok: false, reason: 'invalid_transition' }

  const moved = await transition(deps, {
    requestId: request.id,
    to: 'plan_approved',
    reason: null,
    actorId: input.decidedById,
    actorRole: input.actorRole,
  })
  return moved.ok ? { ok: true } : { ok: false, reason: 'invalid_transition' }
}

/** Decompose a complex package: children created from the approved plan. */
export async function decomposePackage(
  deps: ServiceRequestsDeps,
  input: { requestId: string; actorId: string },
): Promise<number> {
  const request = await deps.db.serviceRequest.findUnique({ where: { id: input.requestId } })
  if (!request || request.serviceLine !== 'complex_package') return 0

  const plan = await deps.db.serviceRequestPlan.findFirst({
    where: { requestId: request.id, status: 'approved' },
    orderBy: { version: 'desc' },
  })
  if (!plan) return 0

  const existing = await deps.db.serviceRequest.count({ where: { parentRequestId: request.id } })
  if (existing > 0) return 0

  const content = plan.content as { childRequests: Array<{ serviceLine: string; title: string; objective: string }> }
  let created = 0
  for (const child of content.childRequests) {
    await createRequest(deps, {
      serviceLine: child.serviceLine as ServiceLine,
      title: child.title,
      objective: child.objective,
      requestedById: input.actorId,
      parentRequestId: request.id,
      initialStatus: 'submitted',
    })
    created += 1
  }
  return created
}
