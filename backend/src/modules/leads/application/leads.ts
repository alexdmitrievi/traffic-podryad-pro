import { createHash } from 'node:crypto'
import type { Db } from '../../../db'

export interface LeadsDeps {
  db: Db
}

export interface SubmitLeadInput {
  productId: string | null
  volume: number | null
  volumeUnit: string | null
  deliveryRegionId: string | null
  deliveryBasisId: string | null
  companyName: string | null
  inn: string | null
  contactName: string
  phone: string | null
  email: string | null
  message: string | null
  visitorId: string | null
  landingPath: string | null
  contentItemId: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  utmTerm: string | null
  consentTextVersion: string
  privacyPolicyVersion: string
}

export function dedupeHashFor(input: Pick<SubmitLeadInput, 'phone' | 'email' | 'productId'>): string {
  const identity = [input.phone ?? '', input.email ?? '', input.productId ?? ''].join('|')
  return createHash('sha256').update(identity).digest('hex')
}

/**
 * Lead capture with consent recorded structurally (docs/ATTRIBUTION.md section 5). A
 * repeat submission of the same contact and product adds a touch instead of creating a
 * second lead — the repetition itself is the signal. Touches recorded for the visitor
 * are linked and get their first/last positions here.
 */
export async function submitLead(
  deps: LeadsDeps,
  input: SubmitLeadInput,
): Promise<{ leadId: string; deduplicated: boolean }> {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  const dedupeHash = dedupeHashFor(input)

  const existing = await deps.db.lead.findUnique({
    where: { workspaceId_dedupeHash: { workspaceId: workspace.id, dedupeHash } },
  })

  if (existing) {
    await deps.db.attributionTouch.create({
      data: {
        workspaceId: workspace.id,
        visitorId: input.visitorId ?? crypto.randomUUID(),
        leadId: existing.id,
        contentItemId: input.contentItemId,
        path: input.landingPath ?? '/',
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
        utmContent: input.utmContent,
        utmTerm: input.utmTerm,
        position: 'last',
      },
    })
    return { leadId: existing.id, deduplicated: true }
  }

  const lead = await deps.db.lead.create({
    data: {
      workspaceId: workspace.id,
      productId: input.productId,
      volume: input.volume,
      volumeUnit: input.volumeUnit === null ? null : (input.volumeUnit as 'tonne' | 'litre' | 'cubic_metre' | 'kilogram' | 'piece'),
      deliveryRegionId: input.deliveryRegionId,
      deliveryBasisId: input.deliveryBasisId,
      companyName: input.companyName,
      inn: input.inn,
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
      message: input.message,
      landingPath: input.landingPath,
      contentItemId: input.contentItemId,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmContent: input.utmContent,
      utmTerm: input.utmTerm,
      consentAt: new Date(),
      consentTextVersion: input.consentTextVersion,
      privacyPolicyVersion: input.privacyPolicyVersion,
      dedupeHash,
      status: 'new',
    },
  })

  if (input.visitorId) {
    const touches = await deps.db.attributionTouch.findMany({
      where: { workspaceId: workspace.id, visitorId: input.visitorId, leadId: null },
      orderBy: { occurredAt: 'asc' },
    })
    for (let index = 0; index < touches.length; index++) {
      const position = index === 0 ? 'first' : index === touches.length - 1 ? 'last' : 'middle'
      await deps.db.attributionTouch.update({
        where: { id: touches[index]!.id },
        data: { leadId: lead.id, position },
      })
    }
  }

  return { leadId: lead.id, deduplicated: false }
}

export async function listLeads(deps: LeadsDeps) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  return deps.db.lead.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: 'desc' },
  })
}
