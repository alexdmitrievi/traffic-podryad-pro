import type { Db } from '../../../db'
import type { Outbox } from '../../../outbox/outbox-service'
import type { InstrumentedLlmPort } from '../../../providers/llm/instrumentation'
import { hashCanonical } from '../../../shared/hashing'

export interface ContentDeps {
  db: Db
  llm: InstrumentedLlmPort
  outbox: Outbox
}

// ── Briefs ─────────────────────────────────────────────────────────────────────

export interface BriefRecord {
  id: string
  clusterId: string
  title: string
  outline: unknown
  targetKeywordIds: string[]
  audience: string | null
  tone: string | null
  status: string
  authorKind: 'human' | 'llm'
  llmRunId: string | null
  contentHash: string
  createdAt: Date
  updatedAt: Date
}

/** Step 8–9: the brief row is created and the generation task goes to the outbox. */
export async function createBrief(
  deps: ContentDeps,
  input: { clusterId: string; actorId: string },
): Promise<BriefRecord | null> {
  const cluster = await deps.db.topicCluster.findUnique({
    where: { id: input.clusterId },
    include: { keywords: { include: { keyword: true } } },
  })
  if (!cluster) return null

  const workspace = await deps.db.workspace.findFirstOrThrow()
  const targetKeywordIds = cluster.keywords.map((entry) => entry.keywordId)
  const brief = await deps.db.contentBrief.create({
    data: {
      workspaceId: workspace.id,
      clusterId: cluster.id,
      title: `${cluster.title}: бриф`,
      outline: [],
      targetKeywordIds,
      audience: null,
      tone: null,
      status: 'draft',
      authorKind: 'llm',
      contentHash: hashCanonical({ clusterId: cluster.id, targetKeywordIds: [...targetKeywordIds].sort() }),
    },
  })

  await deps.outbox.enqueue({
    taskType: 'brief.generate',
    dedupeKey: `brief.generate:${brief.id}`,
    payload: { briefId: brief.id },
  })

  return brief as unknown as BriefRecord
}

export async function listBriefs(deps: ContentDeps, input: { clusterId?: string }) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  return deps.db.contentBrief.findMany({
    where: {
      workspaceId: workspace.id,
      ...(input.clusterId ? { clusterId: input.clusterId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })
}

/** Step 9: the human gate on the brief. */
export async function reviewBrief(
  deps: ContentDeps,
  input: { briefId: string; approve: boolean },
): Promise<boolean> {
  const brief = await deps.db.contentBrief.findUnique({ where: { id: input.briefId } })
  if (!brief || brief.status !== 'in_review') return false

  await deps.db.contentBrief.update({
    where: { id: brief.id },
    data: { status: input.approve ? 'approved' : 'rejected' },
  })
  return true
}

// ── Content items and revisions ────────────────────────────────────────────────

export interface ItemRecord {
  id: string
  briefId: string
  slug: string
  title: string
  locale: string
  productId: string | null
  regionId: string | null
  status: string
  currentRevisionId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface RevisionRecord {
  id: string
  contentItemId: string
  revisionNumber: number
  bodyMarkdown: string
  metaTitle: string | null
  metaDescription: string | null
  contentHash: string
  authorKind: 'human' | 'llm'
  authorId: string | null
  llmRunId: string | null
  createdAt: Date
}

/** Step 10: the item is created from an approved brief; the draft task goes to the outbox. */
export async function createItem(
  deps: ContentDeps,
  input: { briefId: string; slug?: string },
): Promise<ItemRecord | null> {
  const brief = await deps.db.contentBrief.findUnique({
    where: { id: input.briefId },
    include: { cluster: true },
  })
  if (!brief || brief.status !== 'approved') return null

  const workspace = await deps.db.workspace.findFirstOrThrow()
  const item = await deps.db.contentItem.create({
    data: {
      workspaceId: workspace.id,
      briefId: brief.id,
      slug: input.slug ?? `article-${crypto.randomUUID().slice(0, 8)}`,
      title: brief.title,
      locale: 'ru',
      productId: brief.cluster.productId,
      regionId: brief.cluster.regionId,
      status: 'draft',
    },
  })

  await deps.outbox.enqueue({
    taskType: 'draft.generate',
    dedupeKey: `draft.generate:${item.id}`,
    payload: { contentItemId: item.id },
  })

  return item as unknown as ItemRecord
}

/** Step 11: a human edit is a new immutable revision, never an update. */
export async function createRevision(
  deps: ContentDeps,
  input: {
    contentItemId: string
    bodyMarkdown: string
    metaTitle?: string
    metaDescription?: string
    authorId: string
  },
): Promise<RevisionRecord | null> {
  const item = await deps.db.contentItem.findUnique({ where: { id: input.contentItemId } })
  if (!item) return null

  const workspace = await deps.db.workspace.findFirstOrThrow()
  const last = await deps.db.contentRevision.findFirst({
    where: { contentItemId: item.id },
    orderBy: { revisionNumber: 'desc' },
  })

  const bodyMarkdown = input.bodyMarkdown
  const metaTitle = input.metaTitle ?? null
  const metaDescription = input.metaDescription ?? null
  const contentHash = hashCanonical({ bodyMarkdown, metaTitle, metaDescription })

  const revision = await deps.db.contentRevision.create({
    data: {
      workspaceId: workspace.id,
      contentItemId: item.id,
      revisionNumber: (last?.revisionNumber ?? 0) + 1,
      bodyMarkdown,
      metaTitle,
      metaDescription,
      contentHash,
      authorKind: 'human',
      authorId: input.authorId,
    },
  })

  await deps.db.contentItem.update({
    where: { id: item.id },
    data: { currentRevisionId: revision.id, status: 'in_review' },
  })

  return revision as unknown as RevisionRecord
}

export async function listItems(deps: ContentDeps) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  return deps.db.contentItem.findMany({
    where: { workspaceId: workspace.id },
    include: { revisions: { orderBy: { revisionNumber: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getItem(deps: ContentDeps, id: string) {
  return deps.db.contentItem.findUnique({
    where: { id },
    include: { revisions: { orderBy: { revisionNumber: 'asc' } } },
  })
}

export async function getRevision(deps: ContentDeps, id: string) {
  return deps.db.contentRevision.findUnique({ where: { id } })
}

// ── Outbox tasks ───────────────────────────────────────────────────────────────

/** 'brief.generate' — runs in the worker; the LLM writes the outline. */
export async function runBriefGeneration(deps: ContentDeps, payload: { briefId: string }): Promise<void> {
  const brief = await deps.db.contentBrief.findUnique({
    where: { id: payload.briefId },
    include: { cluster: { include: { keywords: { include: { keyword: true } }, product: true, region: true } } },
  })
  if (!brief || brief.status !== 'draft') return

  const cluster = brief.cluster
  const result = await deps.llm.generateBrief({
    keywords: cluster.keywords.map((entry) => entry.keyword.phrase),
    clusterTitle: cluster.title,
    productNames: cluster.product ? [cluster.product.name] : [],
    regionNames: cluster.region ? [cluster.region.name] : [],
    audience: brief.audience,
    tone: brief.tone,
    instructions: ['Структурируй материал. Помечай факты, требующие проверки человеком.'],
  })

  await deps.db.contentBrief.update({
    where: { id: brief.id },
    data: {
      title: result.content.title,
      outline: JSON.parse(JSON.stringify(result.content.outline)),
      audience: result.content.audience,
      tone: result.content.tone,
      status: 'in_review',
      llmRunId: result.runId,
      contentHash: hashCanonical({ title: result.content.title, outline: result.content.outline }),
    },
  })
}

/** 'draft.generate' — runs in the worker; the LLM writes the first revision. */
export async function runDraftGeneration(deps: ContentDeps, payload: { contentItemId: string }): Promise<void> {
  const item = await deps.db.contentItem.findUnique({
    where: { id: payload.contentItemId },
    include: { brief: { include: { cluster: { include: { keywords: { include: { keyword: true } }, product: true, region: true } } } }, revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } },
  })
  if (!item || item.revisions.length > 0) return

  const brief = item.brief
  const outline = Array.isArray(brief.outline)
    ? (brief.outline as Array<{ heading: string; intent: string | null; factsToVerify: string[] }>)
    : []
  const cluster = brief.cluster

  const result = await deps.llm.generateDraft({
    briefTitle: brief.title,
    briefOutline: outline,
    keywords: cluster.keywords.map((entry) => entry.keyword.phrase),
    clusterTitle: cluster.title,
    productNames: cluster.product ? [cluster.product.name] : [],
    regionNames: cluster.region ? [cluster.region.name] : [],
    audience: brief.audience,
    tone: brief.tone,
  })

  const workspace = await deps.db.workspace.findFirstOrThrow()
  const contentHash = hashCanonical({
    bodyMarkdown: result.content.bodyMarkdown,
    metaTitle: result.content.metaTitle,
    metaDescription: result.content.metaDescription,
  })

  const revision = await deps.db.contentRevision.create({
    data: {
      workspaceId: workspace.id,
      contentItemId: item.id,
      revisionNumber: 1,
      bodyMarkdown: result.content.bodyMarkdown,
      metaTitle: result.content.metaTitle,
      metaDescription: result.content.metaDescription,
      contentHash,
      authorKind: 'llm',
      llmRunId: result.runId,
    },
  })

  await deps.db.contentItem.update({
    where: { id: item.id },
    data: { currentRevisionId: revision.id, status: 'in_review' },
  })
}
