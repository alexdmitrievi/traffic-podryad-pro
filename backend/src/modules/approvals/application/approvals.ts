import type { ApprovalSubjectType } from '@traffic/contracts'
import type { Db } from '../../../db'
import { hashCanonical } from '../../../shared/hashing'

/**
 * Subject hashes are looked up by the module that owns the subject; the approvals context
 * refuses to decide when the presented hash does not match the subject's current one.
 */
export type SubjectHashProvider = Partial<
  Record<ApprovalSubjectType, (subjectId: string) => Promise<string | null>>
>

export interface ApprovalsDeps {
  db: Db
  hashProvider: SubjectHashProvider
}

export type DecideResult =
  | { ok: true; approvalId: string }
  | { ok: false; reason: 'subject_not_found' | 'hash_mismatch' }

export async function decide(
  deps: ApprovalsDeps,
  input: {
    subjectType: ApprovalSubjectType
    subjectId: string
    contentHash: string
    decision: 'approved' | 'rejected'
    note: string | null
    decidedById: string
  },
): Promise<DecideResult> {
  const currentHash = await deps.hashProvider[input.subjectType]?.(input.subjectId)
  if (currentHash === null || currentHash === undefined) {
    return { ok: false, reason: 'subject_not_found' }
  }
  if (currentHash !== input.contentHash) {
    // The subject changed while the reviewer was reading it. An approval for a hash the
    // subject no longer carries is the one thing that must never land.
    return { ok: false, reason: 'hash_mismatch' }
  }

  const workspace = await deps.db.workspace.findFirstOrThrow()
  const approval = await deps.db.approval.create({
    data: {
      workspaceId: workspace.id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      contentHash: input.contentHash,
      decision: input.decision,
      decidedById: input.decidedById,
      note: input.note,
    },
  })

  return { ok: true, approvalId: approval.id }
}

export interface ApprovalStateResult {
  currentHash: string | null
  approval: {
    id: string
    decision: string
    contentHash: string
    decidedById: string
    decidedAt: Date
    note: string | null
  } | null
  isApproved: boolean
  reason: 'approved' | 'never_approved' | 'stale' | 'rejected' | 'subject_not_found'
}

export async function state(
  deps: ApprovalsDeps,
  input: { subjectType: ApprovalSubjectType; subjectId: string },
): Promise<ApprovalStateResult> {
  const currentHash = await deps.hashProvider[input.subjectType]?.(input.subjectId)
  if (currentHash === null || currentHash === undefined) {
    return { currentHash: null, approval: null, isApproved: false, reason: 'subject_not_found' }
  }

  const approval = await deps.db.approval.findFirst({
    where: { subjectType: input.subjectType, subjectId: input.subjectId },
    orderBy: { decidedAt: 'desc' },
  })

  if (!approval) {
    return { currentHash, approval: null, isApproved: false, reason: 'never_approved' }
  }
  if (approval.decision === 'rejected') {
    return {
      currentHash,
      approval: { id: approval.id, decision: approval.decision, contentHash: approval.contentHash, decidedById: approval.decidedById, decidedAt: approval.decidedAt, note: approval.note },
      isApproved: false,
      reason: 'rejected',
    }
  }
  if (approval.contentHash !== currentHash) {
    return {
      currentHash,
      approval: { id: approval.id, decision: approval.decision, contentHash: approval.contentHash, decidedById: approval.decidedById, decidedAt: approval.decidedAt, note: approval.note },
      isApproved: false,
      reason: 'stale',
    }
  }

  return {
    currentHash,
    approval: { id: approval.id, decision: approval.decision, contentHash: approval.contentHash, decidedById: approval.decidedById, decidedAt: approval.decidedAt, note: approval.note },
    isApproved: true,
    reason: 'approved',
  }
}

/** Used by other modules: is this subject approved right now, for its current hash? */
export async function isApproved(
  deps: ApprovalsDeps,
  input: { subjectType: ApprovalSubjectType; subjectId: string },
): Promise<boolean> {
  return (await state(deps, input)).isApproved
}

export { hashCanonical }
