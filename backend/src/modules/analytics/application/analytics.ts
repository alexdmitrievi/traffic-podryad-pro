import type { Db } from '../../../db'

export interface AnalyticsDeps {
  db: Db
}

/**
 * The funnel screen (docs/ATTRIBUTION.md section 7): honest counts from own data, no
 * fabricated charts on an empty base — empty states stay empty.
 */
export async function funnelSummary(deps: AnalyticsDeps) {
  const workspace = await deps.db.workspace.findFirstOrThrow()

  const [publishedContentCount, leadCount, attributedLeadCount] = await Promise.all([
    deps.db.publication.count({ where: { workspaceId: workspace.id, status: 'published' } }),
    deps.db.lead.count({ where: { workspaceId: workspace.id } }),
    deps.db.lead.count({
      where: { workspaceId: workspace.id, touches: { some: {} } },
    }),
  ])

  const byCluster = await deps.db.topicCluster.findMany({
    where: { workspaceId: workspace.id },
    include: { briefs: { include: { contentItems: { include: { leads: true } } } } },
  })
  const clusterRows = byCluster.map((cluster) => ({
    clusterId: cluster.id,
    clusterTitle: cluster.title,
    leadCount: new Set(
      cluster.briefs.flatMap((brief) => brief.contentItems.flatMap((item) => item.leads.map((lead) => lead.id))),
    ).size,
  }))

  const byProduct = await deps.db.product.findMany({
    where: { workspaceId: workspace.id },
    include: { leads: true },
  })
  const productRows = byProduct.map((product) => ({
    productId: product.id,
    productName: product.name,
    leadCount: product.leads.length,
  }))

  const byRegion = await deps.db.region.findMany({
    where: { workspaceId: workspace.id, leads: { some: {} } },
    include: { leads: true },
  })
  const regionRows = byRegion.map((region) => ({
    regionId: region.id,
    regionName: region.name,
    leadCount: region.leads.length,
  }))

  return {
    publishedContentCount,
    leadCount,
    attributedLeadCount,
    byCluster: clusterRows,
    byProduct: productRows,
    byRegion: regionRows,
  }
}
