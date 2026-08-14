import type { Db } from '../../../db'

export interface AttributionDeps {
  db: Db
}

export interface RecordTouchInput {
  visitorId: string
  path: string
  referrer: string | null
  contentItemId: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  utmTerm: string | null
}

/** A touch is recorded before anyone becomes a lead; it carries no personal data. */
export async function recordTouch(deps: AttributionDeps, input: RecordTouchInput): Promise<void> {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  await deps.db.attributionTouch.create({
    data: {
      workspaceId: workspace.id,
      visitorId: input.visitorId,
      contentItemId: input.contentItemId,
      path: input.path,
      referrer: input.referrer,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmContent: input.utmContent,
      utmTerm: input.utmTerm,
    },
  })
}

export interface AttributionChain {
  leadId: string
  firstTouch: unknown | null
  lastTouch: unknown | null
  contentItemId: string | null
  contentTitle: string | null
  clusterId: string | null
  clusterTitle: string | null
  keywordId: string | null
  keywordPhrase: string | null
  productId: string | null
  productName: string | null
  regionId: string | null
  regionName: string | null
}

/**
 * The chain the whole pipeline exists to produce (docs/ATTRIBUTION.md section 1):
 * every link is a real foreign key, resolved here in one query plan.
 */
export async function attributionChain(
  deps: AttributionDeps,
  leadId: string,
): Promise<AttributionChain | null> {
  const lead = await deps.db.lead.findUnique({
    where: { id: leadId },
    include: { touches: { orderBy: { occurredAt: 'asc' } } },
  })
  if (!lead) return null

  const touches = lead.touches
  const lastTouch = touches.findLast((touch) => touch.contentItemId !== null) ?? null
  const firstTouch = touches.find((touch) => touch.contentItemId !== null) ?? null

  const contentItemId = lastTouch?.contentItemId ?? lead.contentItemId
  let contentItem = null
  let cluster = null
  if (contentItemId) {
    contentItem = await deps.db.contentItem.findUnique({
      where: { id: contentItemId },
      include: {
        product: true,
        region: true,
        brief: { include: { cluster: { include: { pillarKeyword: true } } } },
      },
    })
    cluster = contentItem?.brief.cluster ?? null
  }

  return {
    leadId: lead.id,
    firstTouch: firstTouch ? serializeTouch(firstTouch) : null,
    lastTouch: lastTouch ? serializeTouch(lastTouch) : null,
    contentItemId: contentItem?.id ?? null,
    contentTitle: contentItem?.title ?? null,
    clusterId: cluster?.id ?? null,
    clusterTitle: cluster?.title ?? null,
    keywordId: cluster?.pillarKeyword?.id ?? null,
    keywordPhrase: cluster?.pillarKeyword?.phrase ?? null,
    productId: contentItem?.product?.id ?? null,
    productName: contentItem?.product?.name ?? null,
    regionId: contentItem?.region?.id ?? null,
    regionName: contentItem?.region?.name ?? null,
  }
}

const serializeTouch = (touch: {
  id: string
  workspaceId: string
  visitorId: string
  leadId: string | null
  contentItemId: string | null
  path: string
  referrer: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  utmTerm: string | null
  position: string | null
  occurredAt: Date
}) => ({
  id: touch.id,
  workspaceId: touch.workspaceId,
  visitorId: touch.visitorId,
  leadId: touch.leadId,
  contentItemId: touch.contentItemId,
  path: touch.path,
  referrer: touch.referrer,
  utmSource: touch.utmSource,
  utmMedium: touch.utmMedium,
  utmCampaign: touch.utmCampaign,
  utmContent: touch.utmContent,
  utmTerm: touch.utmTerm,
  position: touch.position,
  occurredAt: touch.occurredAt.toISOString(),
})
