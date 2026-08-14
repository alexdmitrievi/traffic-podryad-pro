/**
 * Structural tests for schema.prisma.
 *
 * `prisma validate` proves the file parses. These prove it says what the architecture
 * documents say it must — the part a parser has no opinion about.
 *
 * Enums are checked against `@traffic/contracts` in both directions. A schema enum and a Zod
 * enum drifting apart is the failure that produces a runtime error nobody can reproduce
 * locally, and nothing except a test like this notices it.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import { contracts } from '@traffic/contracts'

const prismaDirectory = path.dirname(fileURLToPath(import.meta.url))
const schema = await readFile(path.join(prismaDirectory, 'schema.prisma'), 'utf8')

/**
 * Declarations only, with `//` and `///` lines removed.
 *
 * The vector-gate assertions below search for forbidden tokens, and the schema's own header
 * explains at length why those tokens are absent. Scanning the prose would fail on the
 * explanation of the rule — so the rule is checked against what the database actually gets.
 */
const declarations = schema
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')

/** Model bodies, keyed by model name. */
function parseModels(source) {
  const models = new Map()
  for (const match of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    models.set(match[1], match[2])
  }
  return models
}

/** Enum values, keyed by enum name. */
function parseEnums(source) {
  const enums = new Map()
  for (const match of source.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const values = match[2]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('@@') && !line.startsWith('//') && !line.startsWith('///'))
    enums.set(match[1], values)
  }
  return enums
}

const models = parseModels(schema)
const enums = parseEnums(schema)

/** Tables that legitimately have no workspace scope: they hang off a user or a request,
 *  or they are backend machinery rather than product data (the durable outbox). */
const workspaceExempt = new Set([
  'Workspace',
  'User',
  'AuthSession',
  'PasswordResetToken',
  'ClusterKeyword',
  'TaskOutbox',
])

describe('models', () => {
  test('every entity the architecture requires exists', () => {
    for (const name of [
      'Workspace',
      'User',
      'AuthSession',
      'PasswordResetToken',
      'Vertical',
      'Region',
      'ProductCategory',
      'Product',
      'DeliveryBasis',
      'ServiceRequest',
      'ServiceRequestPlan',
      'ServiceRequestEvent',
      'Keyword',
      'KeywordMetric',
      'TopicCluster',
      'ClusterKeyword',
      'ContentBrief',
      'ContentItem',
      'ContentRevision',
      'Publication',
      'CtaPlacement',
      'Approval',
      'Lead',
      'AttributionTouch',
      'LlmRun',
      'AuditLog',
      'TaskOutbox',
    ]) {
      expect(models.has(name)).toBe(true)
    }
  })

  test('every product table carries workspace_id', () => {
    for (const [name, body] of models) {
      if (workspaceExempt.has(name)) continue
      expect(body).toContain('workspaceId')
      expect(body).toContain('@map("workspace_id")')
    }
  })

  test('every primary key is an application-generated UUIDv7 in a native uuid column', () => {
    for (const [name, body] of models) {
      // ClusterKeyword uses a composite key of two uuid foreign keys.
      if (name === 'ClusterKeyword') {
        expect(body).toContain('@@id([clusterId, keywordId])')
        continue
      }

      expect(body).toContain('@id @default(uuid(7)) @db.Uuid')
    }
  })

  test('every model maps to a snake_case table name', () => {
    for (const [, body] of models) {
      const mapped = body.match(/@@map\("([^"]+)"\)/)?.[1]
      expect(mapped).toBeDefined()
      expect(mapped).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })
})

describe('the approval invariant', () => {
  test('publications.approval_id is required, not optional', () => {
    const body = models.get('Publication') ?? ''
    const line = body.split('\n').find((entry) => entry.includes('approvalId'))

    expect(line).toBeDefined()
    // A `?` here would turn the central invariant into a suggestion.
    expect(line).not.toMatch(/String\?/)
    expect(line).toContain('@map("approval_id")')
  })

  test('the approval foreign key restricts deletion', () => {
    const body = models.get('Publication') ?? ''

    expect(body).toMatch(/approval\s+Approval\s+@relation\([^)]*onDelete:\s*Restrict/)
  })

  test('approvals bind to a content hash and record who decided', () => {
    const body = models.get('Approval') ?? ''

    expect(body).toContain('contentHash')
    expect(body).toContain('decidedById')
    expect(body).toContain('decidedAt')
  })

  test('revisions carry a content hash, which is what an approval points at', () => {
    expect(models.get('ContentRevision') ?? '').toContain('contentHash')
    expect(models.get('ServiceRequestPlan') ?? '').toContain('contentHash')
  })
})

describe('personal data and consent', () => {
  test('lead consent columns are required', () => {
    const body = models.get('Lead') ?? ''

    for (const field of ['consentAt', 'consentTextVersion', 'privacyPolicyVersion']) {
      const line = body.split('\n').find((entry) => entry.trim().startsWith(field))
      expect(line).toBeDefined()
      expect(line).not.toMatch(/\?\s/)
    }
  })

  test('llm runs store a prompt hash, never the prompt or the completion', () => {
    const body = models.get('LlmRun') ?? ''

    expect(body).toContain('promptHash')
    expect(body).not.toMatch(/\bprompt\s+String/)
    expect(body).not.toMatch(/\bcompletion\b/)
    expect(body).not.toMatch(/\bresponseText\b/)
  })
})

describe('the production vector gate', () => {
  test('the schema declares no vector column, index or extension', () => {
    const lowered = declarations.toLowerCase()

    expect(lowered).not.toContain('pgvector')
    expect(lowered).not.toContain('vector(')
    expect(lowered).not.toContain('hnsw')
    expect(lowered).not.toContain('ivfflat')
    expect(lowered).not.toContain('postgresqlextensions')
    expect(lowered).not.toContain('extensions =')
  })

  test('the guard reads declarations, not the comment explaining the guard', () => {
    // Without this, the assertion above could pass simply because the token disappeared from
    // the prose while a real column was added.
    expect(schema.toLowerCase()).toContain('pgvector')
    expect(declarations.toLowerCase()).not.toContain('pgvector')
  })

  test('no model declares an embedding field', () => {
    for (const [, body] of models) {
      const fields = body
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
      expect(fields.toLowerCase()).not.toMatch(/^\s*embedding\s/m)
    }
  })

  test('the datasource declares no extensions and no url', () => {
    const datasource = declarations.match(/datasource\s+db\s*\{([\s\S]*?)\}/)?.[1] ?? ''

    expect(datasource).toContain('provider = "postgresql"')
    expect(datasource).not.toContain('extensions')
    // Prisma 7 moved connection URLs out of the schema; a url here would not even parse.
    expect(datasource).not.toContain('url')
  })
})

describe('enums match the contracts', () => {
  const pairs = [
    ['UserRole', contracts.users.userRoleSchema],
    ['ServiceLine', contracts.serviceRequests.serviceLineSchema],
    ['ServiceRequestStatus', contracts.serviceRequests.serviceRequestStatusSchema],
    ['PlanStatus', contracts.plans.planStatusSchema],
    ['AuthorKind', contracts.plans.authorKindSchema],
    ['RegionKind', contracts.catalog.regionKindSchema],
    ['MeasurementUnit', contracts.catalog.measurementUnitSchema],
    ['KeywordIntent', contracts.research.keywords.keywordIntentSchema],
    ['KeywordSource', contracts.research.keywords.keywordSourceSchema],
    ['TopicClusterStatus', contracts.research.topicClusters.topicClusterStatusSchema],
    ['BriefStatus', contracts.content.briefStatusSchema],
    ['ContentStatus', contracts.content.contentStatusSchema],
    ['PublicationTarget', contracts.content.publicationTargetSchema],
    ['PublicationStatus', contracts.content.publicationStatusSchema],
    ['ApprovalSubjectType', contracts.approvals.approvalSubjectTypeSchema],
    ['ApprovalDecision', contracts.approvals.approvalDecisionSchema],
    ['LeadStatus', contracts.leads.leadStatusSchema],
    ['TouchPosition', contracts.attribution.touchPositionSchema],
    ['LlmRunPurpose', contracts.llmRuns.llmRunPurposeSchema],
    ['LlmRunStatus', contracts.llmRuns.llmRunStatusSchema],
    ['TaskOutboxStatus', contracts.outbox.taskOutboxStatusSchema],
  ]

  for (const [enumName, zodSchema] of pairs) {
    test(`${enumName} has exactly the contract's values`, () => {
      expect(enums.has(enumName)).toBe(true)
      expect([...(enums.get(enumName) ?? [])].sort()).toEqual([...zodSchema.options].sort())
    })
  }

  test('every schema enum is covered by this comparison', () => {
    const compared = new Set(pairs.map(([name]) => name))

    for (const name of enums.keys()) {
      expect(compared.has(name)).toBe(true)
    }
  })

  test('planned_awaiting_capability survives in the schema', () => {
    expect(enums.get('ServiceRequestStatus')).toContain('planned_awaiting_capability')
  })
})

describe('schema integrity', () => {
  test('the parser found models and enums, so the assertions above ran against something', () => {
    expect(models.size).toBeGreaterThanOrEqual(26)
    expect(enums.size).toBeGreaterThanOrEqual(20)
  })
})
