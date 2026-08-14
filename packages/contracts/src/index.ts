/**
 * `@traffic/contracts` — the single source of truth for API payloads, DTOs and the error
 * envelope.
 *
 * A new endpoint starts here. The backend validates requests with these schemas and generates
 * OpenAPI from them; the webapp uses the same schemas in forms and API clients. Nothing here
 * contains business logic, and nothing imports a framework, a persistence layer or a provider
 * SDK — `bun run architecture:check` enforces that.
 *
 * Two ways to consume this package:
 *
 *   import { contracts } from '@traffic/contracts'
 *   contracts.serviceRequests.serviceRequestSchema
 *
 *   import { serviceRequestSchema } from '@traffic/contracts'
 *
 * The tree is the one to prefer at call sites: it says which context a schema belongs to,
 * which is exactly the thing a flat import loses.
 */

import * as approvals from './approvals'
import * as attribution from './attribution'
import * as auth from './auth'
import * as catalog from './catalog'
import * as common from './common'
import * as content from './content'
import * as errors from './errors'
import * as evidence from './evidence'
import * as geoQueries from './geo-queries'
import * as geoSnapshots from './geo-snapshots'
import * as keywords from './keywords'
import * as llmRuns from './llm-runs'
import * as leads from './leads'
import * as outbox from './outbox'
import * as serviceRequestPlans from './service-request-plans'
import * as serviceRequests from './service-requests'
import * as topicClusters from './topic-clusters'
import * as users from './users'

export const contracts = {
  common,
  errors,

  /** Accounts, sessions, roles. */
  auth,
  users,

  /** The front door: requests, their versioned plans and their transition log. */
  serviceRequests,
  plans: serviceRequestPlans,

  /**
   * Generic taxonomy of what a workspace sells. Petroleum is the first workspace's seed
   * data, not the shape of these types.
   */
  catalog,

  /** Keyword research and topic clustering. */
  research: {
    keywords,
    topicClusters,
  },

  /** Briefs, articles, immutable revisions, publications and calls to action. */
  content,

  /** The gate every publication passes through. */
  approvals,

  /** Inbound demand and where it came from. */
  leads,
  attribution,

  /** Facts a human verified against a source before content may use them (GEO wave). */
  evidence,

  /** The GEO question inventory: what people ask, triaged by a human. */
  geoQueries,

  /** Manual GEO visibility snapshots, append-only series over time. */
  geoSnapshots,

  /** Model usage and its cost. */
  llmRuns,

  /** Durable outbox machinery; backend infrastructure with enum parity to the schema. */
  outbox,
} as const

export type Contracts = typeof contracts

export * from './approvals'
export * from './attribution'
export * from './auth'
export * from './catalog'
export * from './common'
export * from './content'
export * from './errors'
export * from './evidence'
export * from './geo-queries'
export * from './geo-snapshots'
export * from './keywords'
export * from './leads'
export * from './llm-runs'
export * from './outbox'
export * from './service-request-plans'
export * from './service-requests'
export * from './topic-clusters'
export * from './users'
