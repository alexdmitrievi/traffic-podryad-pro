import type { Db } from '../../../db'
import type { ApprovalsDeps } from '../../approvals'
import { decide, state } from '../../approvals'
import { hashCanonical } from '../../../shared/hashing'
import { isUsableClaim } from '../../evidence'
import { GeoQueryNotFoundError } from './geo'

export interface GeoAnswerDeps {
  db: Db
  approvals: ApprovalsDeps
}

export class GeoQueryNotPlannedError extends Error {
  constructor() {
    super('an answer asset is created only for a planned question')
    this.name = 'GeoQueryNotPlannedError'
  }
}

export class GeoAnswerExistsError extends Error {
  constructor() {
    super('the question already has an answer asset')
    this.name = 'GeoAnswerExistsError'
  }
}

export class GeoAnswerNotFoundError extends Error {
  constructor() {
    super('geo answer asset not found')
    this.name = 'GeoAnswerNotFoundError'
  }
}

export class GeoClaimNotUsableError extends Error {
  constructor(public readonly claimIds: string[]) {
    super(`the answer links claims that are not verified or are superseded: ${claimIds.join(', ')}`)
    this.name = 'GeoClaimNotUsableError'
  }
}

function hashAnswer(bodyMarkdown: string, linkedClaimIds: string[]): string {
  return hashCanonical({ bodyMarkdown, linkedClaimIds: [...linkedClaimIds].sort() })
}

/** The linked claims must all exist and be verified, non-superseded claims. */
async function assertClaimsUsable(deps: GeoAnswerDeps, claimIds: string[]): Promise<void> {
  const claims = await deps.db.claim.findMany({ where: { id: { in: claimIds } } })
  const byId = new Map(claims.map((claim) => [claim.id, claim]))
  const unusable = claimIds.filter((id) => {
    const claim = byId.get(id)
    return !claim || !isUsableClaim(claim)
  })
  if (unusable.length > 0) throw new GeoClaimNotUsableError(unusable)
}

export async function createAnswer(
  deps: GeoAnswerDeps,
  input: { queryId: string; bodyMarkdown: string; linkedClaimIds: string[] },
) {
  const query = await deps.db.geoQuery.findUnique({ where: { id: input.queryId } })
  if (!query) throw new GeoQueryNotFoundError()
  if (query.status !== 'planned') throw new GeoQueryNotPlannedError()
  const existing = await deps.db.geoAnswerAsset.findUnique({ where: { queryId: query.id } })
  if (existing) throw new GeoAnswerExistsError()

  await assertClaimsUsable(deps, input.linkedClaimIds)
  const sorted = [...input.linkedClaimIds].sort()

  const asset = await deps.db.geoAnswerAsset.create({
    data: {
      workspaceId: query.workspaceId,
      queryId: query.id,
      bodyMarkdown: input.bodyMarkdown,
      linkedClaimIds: sorted,
      contentHash: hashAnswer(input.bodyMarkdown, sorted),
    },
  })
  return serializeAnswer(asset)
}

export async function updateAnswer(
  deps: GeoAnswerDeps,
  input: { answerId: string; bodyMarkdown?: string; linkedClaimIds?: string[] },
) {
  const asset = await deps.db.geoAnswerAsset.findUnique({ where: { id: input.answerId } })
  if (!asset) throw new GeoAnswerNotFoundError()

  const bodyMarkdown = input.bodyMarkdown ?? asset.bodyMarkdown
  const sorted = [...(input.linkedClaimIds ?? asset.linkedClaimIds)].sort()
  if (input.linkedClaimIds !== undefined) {
    await assertClaimsUsable(deps, sorted)
  }

  const updated = await deps.db.geoAnswerAsset.update({
    where: { id: asset.id },
    data: {
      bodyMarkdown,
      linkedClaimIds: sorted,
      contentHash: hashAnswer(bodyMarkdown, sorted),
    },
  })
  return serializeAnswer(updated)
}

export async function listAnswers(
  deps: GeoAnswerDeps,
  input: { queryId?: string },
) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  const assets = await deps.db.geoAnswerAsset.findMany({
    where: { workspaceId: workspace.id, ...(input.queryId ? { queryId: input.queryId } : {}) },
    include: { query: true },
    orderBy: { createdAt: 'asc' },
  })

  const serialized = []
  for (const asset of assets) {
    const approvalState = await state(deps.approvals, {
      subjectType: 'geo_answer_asset',
      subjectId: asset.id,
    })
    serialized.push({
      ...serializeAnswer(asset),
      question: asset.query.question,
      isApproved: approvalState.isApproved,
      approvalId: approvalState.approval?.id ?? null,
    })
  }
  return serialized
}

/**
 * The approval gate, shared with plans, revisions and publications: the presented hash
 * must be the one the asset carries right now. On success the question becomes answered.
 */
export async function approveAnswer(
  deps: GeoAnswerDeps,
  input: { answerId: string; contentHash: string; note: string | null; decidedById: string },
) {
  const asset = await deps.db.geoAnswerAsset.findUnique({
    where: { id: input.answerId },
    include: { query: true },
  })
  if (!asset) throw new GeoAnswerNotFoundError()

  await assertClaimsUsable(deps, asset.linkedClaimIds)

  const result = await decide(deps.approvals, {
    subjectType: 'geo_answer_asset',
    subjectId: asset.id,
    contentHash: input.contentHash,
    decision: 'approved',
    note: input.note,
    decidedById: input.decidedById,
  })

  if (!result.ok) {
    if (result.reason === 'subject_not_found') throw new GeoAnswerNotFoundError()
    return { ok: false as const, reason: 'hash_mismatch' as const }
  }

  if (asset.query.status === 'planned') {
    await deps.db.geoQuery.update({
      where: { id: asset.queryId },
      data: { status: 'answered', statusReason: null },
    })
  }

  return { ok: true as const, approvalId: result.approvalId }
}

export function serializeAnswer(asset: {
  id: string
  workspaceId: string
  queryId: string
  bodyMarkdown: string
  contentHash: string
  linkedClaimIds: string[]
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: asset.id,
    workspaceId: asset.workspaceId,
    queryId: asset.queryId,
    bodyMarkdown: asset.bodyMarkdown,
    contentHash: asset.contentHash,
    linkedClaimIds: asset.linkedClaimIds,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  }
}
