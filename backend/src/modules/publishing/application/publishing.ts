import type { Db } from '../../../db'
import type { Outbox } from '../../../outbox/outbox-service'
import type { PublishingPort } from '../../../providers/publishing/port'

export interface PublishingDeps {
  db: Db
  outbox: Outbox
  publishing: PublishingPort
}

export type PublishResult =
  | { ok: true; publicationId: string }
  | { ok: false; reason: 'revision_not_found' | 'approval_required' | 'approval_stale' | 'revision_mismatch' }

export interface PublicationRecord {
  id: string
  contentItemId: string
  revisionId: string
  approvalId: string
  target: string
  status: string
  publicUrl: string | null
  publishedAt: Date | null
  publishedById: string | null
  createdAt: Date
}

/**
 * The central invariant of the product: publication is impossible without an approval
 * bound to the exact content hash of the revision being published
 * (docs/COMPLIANCE.md section 7). The check lives here, server-side, on every path —
 * the schema's NOT NULL foreign key is the backstop, this is the gate.
 */
export async function publishRevision(
  deps: PublishingDeps,
  input: { contentItemId: string; revisionId: string; actorId: string },
): Promise<PublishResult> {
  const revision = await deps.db.contentRevision.findUnique({
    where: { id: input.revisionId },
  })
  if (!revision || revision.contentItemId !== input.contentItemId) {
    return { ok: false, reason: 'revision_not_found' }
  }

  const approval = await deps.db.approval.findFirst({
    where: { subjectType: 'content_revision', subjectId: revision.id },
    orderBy: { decidedAt: 'desc' },
  })
  if (!approval || approval.decision !== 'approved') {
    return { ok: false, reason: 'approval_required' }
  }
  if (approval.contentHash !== revision.contentHash) {
    // The revision was edited after the approval: the approval no longer covers the
    // content being published. Nothing has to remember to re-approve — the hash says no.
    return { ok: false, reason: 'approval_stale' }
  }

  const workspace = await deps.db.workspace.findFirstOrThrow()
  const publication = await deps.db.publication.create({
    data: {
      workspaceId: workspace.id,
      contentItemId: input.contentItemId,
      revisionId: input.revisionId,
      approvalId: approval.id,
      target: 'internal_website',
      status: 'pending',
      publishedById: input.actorId,
    },
  })

  await deps.outbox.enqueue({
    taskType: 'publication.perform',
    dedupeKey: `publication.perform:${publication.id}`,
    payload: { publicationId: publication.id },
  })

  return { ok: true, publicationId: publication.id }
}

/**
 * The minimal first-party renderer for the MVP: the full SEO surface arrives with the
 * Astro website in unit 4e. Title, description, canonical and a JSON-LD Article block are
 * present in the source HTML — the properties the E2E asserts on.
 */
export function renderPublicationHtml(input: {
  title: string
  description: string | null
  slug: string
  bodyMarkdown: string
}): string {
  const sections = input.bodyMarkdown
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const h1 = line.match(/^# (.+)$/)
      if (h1) return `<h1>${escapeHtml(h1[1]!)}</h1>`
      const h2 = line.match(/^## (.+)$/)
      if (h2) return `<h2>${escapeHtml(h2[1]!)}</h2>`
      const h3 = line.match(/^### (.+)$/)
      if (h3) return `<h3>${escapeHtml(h3[1]!)}</h3>`
      return `<p>${escapeHtml(line)}</p>`
    })
    .join('\n')

  const canonical = `https://pipupi.ru/blog/${input.slug}`
  const description = input.description ?? input.title

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(input.title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${escapeHtml(input.title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description,
    mainEntityOfPage: canonical,
    inLanguage: 'ru',
  })}</script>
</head>
<body>
<article>
${sections}
</article>
</body>
</html>
`
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 'publication.perform' — runs in the worker: render, publish, record. */
export async function runPublication(
  deps: PublishingDeps,
  payload: { publicationId: string },
): Promise<void> {
  const publication = await deps.db.publication.findUnique({
    where: { id: payload.publicationId },
    include: { revision: true, contentItem: true, approval: true },
  })
  if (!publication || publication.status !== 'pending') return

  // The gate holds on the worker path too: an approval that went stale between the
  // request and the task must not reach the site.
  if (publication.approval.contentHash !== publication.revision.contentHash) {
    await deps.db.publication.update({
      where: { id: publication.id },
      data: { status: 'failed' },
    })
    return
  }

  const html = renderPublicationHtml({
    title: publication.revision.metaTitle ?? publication.contentItem.title,
    description: publication.revision.metaDescription,
    slug: publication.contentItem.slug,
    bodyMarkdown: publication.revision.bodyMarkdown,
  })

  const result = await deps.publishing.publish({
    contentItemId: publication.contentItemId,
    revisionId: publication.revisionId,
    slug: publication.contentItem.slug,
    html,
  })

  await deps.db.$transaction(async (tx) => {
    await tx.publication.update({
      where: { id: publication.id },
      data: {
        status: 'published',
        publicUrl: result.publicUrl,
        publishedAt: new Date(),
      },
    })
    await tx.contentItem.update({
      where: { id: publication.contentItemId },
      data: { status: 'published' },
    })
  })
}

export async function listPublications(deps: PublishingDeps) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  return deps.db.publication.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: 'desc' },
  })
}
