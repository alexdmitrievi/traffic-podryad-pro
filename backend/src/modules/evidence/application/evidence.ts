import { createHash } from 'node:crypto'
import type { Db } from '../../../db'
import type {
  ClaimStatus,
  EvidenceSourceKind,
} from '@traffic/contracts'
import { claimStatus } from '../domain/evidence'

export interface EvidenceDeps {
  db: Db
}

export class EvidenceSourceNotFoundError extends Error {
  constructor() {
    super('evidence source not found')
    this.name = 'EvidenceSourceNotFoundError'
  }
}

export class ClaimNotFoundError extends Error {
  constructor() {
    super('claim not found')
    this.name = 'ClaimNotFoundError'
  }
}

export class ClaimSupersededError extends Error {
  constructor() {
    super('the claim is superseded and can no longer be changed')
    this.name = 'ClaimSupersededError'
  }
}

export class ClaimDuplicateError extends Error {
  constructor() {
    super('this exact statement is already recorded for the source')
    this.name = 'ClaimDuplicateError'
  }
}

export interface CitationInput {
  location: string
  quote?: string
}

function statementHash(statement: string): string {
  return createHash('sha256').update(statement).digest('hex')
}

export async function createSource(
  deps: EvidenceDeps,
  input: {
    title: string
    kind: EvidenceSourceKind
    url?: string
    publishedAt?: string
    retrievedAt?: string
    notes?: string
  },
) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  const source = await deps.db.evidenceSource.create({
    data: {
      workspaceId: workspace.id,
      title: input.title,
      kind: input.kind,
      url: input.url ?? null,
      publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
      retrievedAt: input.retrievedAt ? new Date(input.retrievedAt) : null,
      notes: input.notes ?? null,
    },
  })
  return serializeSource(source, 0)
}

/** Idempotent: verification is recorded once; a later call keeps the first stamp. */
export async function verifySource(
  deps: EvidenceDeps,
  input: { sourceId: string; actorId: string },
) {
  const source = await deps.db.evidenceSource.findUnique({ where: { id: input.sourceId } })
  if (!source) throw new EvidenceSourceNotFoundError()

  const updated = await deps.db.evidenceSource.update({
    where: { id: source.id },
    data:
      source.verifiedAt === null
        ? { verifiedAt: new Date(), verifiedById: input.actorId }
        : {},
  })
  return updated
}

export async function listSources(deps: EvidenceDeps) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  const sources = await deps.db.evidenceSource.findMany({
    where: { workspaceId: workspace.id },
    include: { _count: { select: { claims: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return sources.map((source) => serializeSource(source, source._count.claims))
}

export async function createClaim(
  deps: EvidenceDeps,
  input: {
    sourceId: string
    statement: string
    category?: string
    citations: CitationInput[]
  },
) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  const source = await deps.db.evidenceSource.findUnique({ where: { id: input.sourceId } })
  if (!source) throw new EvidenceSourceNotFoundError()

  const hash = statementHash(input.statement)
  const duplicate = await deps.db.claim.findUnique({
    where: {
      workspaceId_sourceId_statementHash: {
        workspaceId: workspace.id,
        sourceId: source.id,
        statementHash: hash,
      },
    },
  })
  if (duplicate) throw new ClaimDuplicateError()

  const claim = await deps.db.claim.create({
    data: {
      workspaceId: workspace.id,
      sourceId: source.id,
      statement: input.statement,
      statementHash: hash,
      category: input.category ?? null,
      citations: {
        create: input.citations.map((citation) => ({
          workspaceId: workspace.id,
          location: citation.location,
          quote: citation.quote ?? null,
        })),
      },
    },
    include: { citations: { orderBy: { createdAt: 'asc' } } },
  })
  return serializeClaim(claim)
}

/** A superseded claim is frozen: its correction already exists, it cannot be verified. */
export async function verifyClaim(
  deps: EvidenceDeps,
  input: { claimId: string; actorId: string },
) {
  const claim = await deps.db.claim.findUnique({ where: { id: input.claimId } })
  if (!claim) throw new ClaimNotFoundError()
  if (claim.supersededById !== null) throw new ClaimSupersededError()

  const updated = await deps.db.claim.update({
    where: { id: claim.id },
    data:
      claim.verifiedAt === null
        ? { verifiedAt: new Date(), verifiedById: input.actorId }
        : {},
    include: { citations: { orderBy: { createdAt: 'asc' } } },
  })
  return serializeClaim(updated)
}

/**
 * A correction is a new claim, never an edit: the old row keeps its statement and
 * citations and links to the replacement, so a citation never silently changes meaning.
 * The replacement inherits omitted fields and starts unverified — a human must check
 * the corrected wording again.
 */
export async function supersedeClaim(
  deps: EvidenceDeps,
  input: {
    claimId: string
    actorId: string
    patch: {
      statement?: string
      sourceId?: string
      category?: string | null
      citations?: CitationInput[]
    }
  },
) {
  const claim = await deps.db.claim.findUnique({
    where: { id: input.claimId },
    include: { citations: { orderBy: { createdAt: 'asc' } } },
  })
  if (!claim) throw new ClaimNotFoundError()
  if (claim.supersededById !== null) throw new ClaimSupersededError()

  const statement = input.patch.statement ?? claim.statement
  const sourceId = input.patch.sourceId ?? claim.sourceId
  const category = input.patch.category !== undefined ? input.patch.category : claim.category
  const citations = input.patch.citations ?? claim.citations.map((citation) => ({
    location: citation.location,
    quote: citation.quote ?? undefined,
  }))

  if (sourceId !== claim.sourceId) {
    const source = await deps.db.evidenceSource.findUnique({ where: { id: sourceId } })
    if (!source) throw new EvidenceSourceNotFoundError()
  }

  const hash = statementHash(statement)
  if (sourceId === claim.sourceId && hash === claim.statementHash) {
    throw new ClaimDuplicateError()
  }

  const replacement = await deps.db.$transaction(async (tx) => {
    const created = await tx.claim.create({
      data: {
        workspaceId: claim.workspaceId,
        sourceId,
        statement,
        statementHash: hash,
        category,
        citations: {
          create: citations.map((citation) => ({
            workspaceId: claim.workspaceId,
            location: citation.location,
            quote: citation.quote ?? null,
          })),
        },
      },
      include: { citations: { orderBy: { createdAt: 'asc' } } },
    })
    await tx.claim.update({
      where: { id: claim.id },
      data: { supersededById: created.id },
    })
    return created
  })

  return serializeClaim(replacement)
}

export async function listClaims(
  deps: EvidenceDeps,
  input: { sourceId?: string; status?: ClaimStatus },
) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  const claims = await deps.db.claim.findMany({
    where: {
      workspaceId: workspace.id,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    },
    include: { citations: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  })

  return claims
    .map(serializeClaim)
    .filter((claim) => input.status === undefined || claim.status === input.status)
}

export function serializeSource(
  source: {
    id: string
    workspaceId: string
    title: string
    kind: EvidenceSourceKind
    url: string | null
    publishedAt: Date | null
    retrievedAt: Date | null
    verifiedAt: Date | null
    verifiedById: string | null
    notes: string | null
    createdAt: Date
    updatedAt: Date
  },
  claimCount: number,
) {
  return {
    id: source.id,
    workspaceId: source.workspaceId,
    title: source.title,
    kind: source.kind,
    url: source.url,
    publishedAt: source.publishedAt?.toISOString() ?? null,
    retrievedAt: source.retrievedAt?.toISOString() ?? null,
    verifiedAt: source.verifiedAt?.toISOString() ?? null,
    verifiedById: source.verifiedById,
    notes: source.notes,
    claimCount,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  }
}

export function serializeClaim(claim: {
  id: string
  workspaceId: string
  sourceId: string
  statement: string
  category: string | null
  verifiedAt: Date | null
  verifiedById: string | null
  supersededById: string | null
  createdAt: Date
  citations: Array<{ id: string; location: string; quote: string | null }>
}) {
  return {
    id: claim.id,
    workspaceId: claim.workspaceId,
    sourceId: claim.sourceId,
    statement: claim.statement,
    category: claim.category,
    verifiedAt: claim.verifiedAt?.toISOString() ?? null,
    verifiedById: claim.verifiedById,
    supersededById: claim.supersededById,
    status: claimStatus(claim),
    citations: claim.citations.map((citation) => ({
      id: citation.id,
      location: citation.location,
      quote: citation.quote,
    })),
    createdAt: claim.createdAt.toISOString(),
  }
}
