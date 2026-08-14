import type { Db } from '../../../db'
import type { GeoQueryPriority, GeoQueryStatus } from '@traffic/contracts'
import { transitionAllowed } from '../domain/geo'

export interface GeoDeps {
  db: Db
}

export class GeoQueryNotFoundError extends Error {
  constructor() {
    super('geo query not found')
    this.name = 'GeoQueryNotFoundError'
  }
}

export class GeoQueryTransitionError extends Error {
  constructor() {
    super('this status transition is not allowed for the query')
    this.name = 'GeoQueryTransitionError'
  }
}

export class GeoQueryReasonRequiredError extends Error {
  constructor() {
    super('a dismissal requires a reason')
    this.name = 'GeoQueryReasonRequiredError'
  }
}

export async function createGeoQuery(
  deps: GeoDeps,
  input: {
    question: string
    clusterId?: string
    productId?: string
    regionId?: string
    priority: GeoQueryPriority
    notes?: string
  },
) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  const query = await deps.db.geoQuery.create({
    data: {
      workspaceId: workspace.id,
      question: input.question,
      clusterId: input.clusterId ?? null,
      productId: input.productId ?? null,
      regionId: input.regionId ?? null,
      priority: input.priority,
      notes: input.notes ?? null,
    },
  })
  return serializeGeoQuery(query)
}

/** Triage: the status moves along the lifecycle; a dismissal records why. */
export async function updateGeoQuery(
  deps: GeoDeps,
  input: {
    queryId: string
    status?: GeoQueryStatus
    statusReason?: string
    priority?: GeoQueryPriority
  },
) {
  const query = await deps.db.geoQuery.findUnique({ where: { id: input.queryId } })
  if (!query) throw new GeoQueryNotFoundError()

  const next = input.status ?? query.status
  if (input.status !== undefined && !transitionAllowed(query.status, input.status)) {
    throw new GeoQueryTransitionError()
  }
  if (next === 'dismissed' && !(input.statusReason ?? query.statusReason)) {
    throw new GeoQueryReasonRequiredError()
  }

  const updated = await deps.db.geoQuery.update({
    where: { id: query.id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.statusReason !== undefined
        ? { statusReason: input.statusReason }
        : input.status === 'answered'
          ? { statusReason: null }
          : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    },
  })
  return serializeGeoQuery(updated)
}

export async function listGeoQueries(
  deps: GeoDeps,
  input: { clusterId?: string; status?: GeoQueryStatus },
) {
  const workspace = await deps.db.workspace.findFirstOrThrow()
  const queries = await deps.db.geoQuery.findMany({
    where: {
      workspaceId: workspace.id,
      ...(input.clusterId ? { clusterId: input.clusterId } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: [{ createdAt: 'asc' }],
  })
  return queries.map(serializeGeoQuery)
}

export function serializeGeoQuery(query: {
  id: string
  workspaceId: string
  question: string
  clusterId: string | null
  productId: string | null
  regionId: string | null
  priority: GeoQueryPriority
  status: GeoQueryStatus
  statusReason: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: query.id,
    workspaceId: query.workspaceId,
    question: query.question,
    clusterId: query.clusterId,
    productId: query.productId,
    regionId: query.regionId,
    priority: query.priority,
    status: query.status,
    statusReason: query.statusReason,
    notes: query.notes,
    createdAt: query.createdAt.toISOString(),
    updatedAt: query.updatedAt.toISOString(),
  }
}
