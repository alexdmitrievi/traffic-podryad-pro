import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { loadEnv } from '../../src/env'
import { createPasswordService } from '../../src/modules/auth'
import { createRuntime } from '../../src/runtime'
import type { Runtime } from '../../src/runtime'
import { createTestDb, testDatabaseUrl } from './helpers'
import type { Db } from '../../src/db'
// @ts-expect-error — JavaScript module without a declaration file
import { applySeed, loadSeedData } from '../../prisma/seed/index.mjs'

/**
 * GEO answer assets against a real database (GEO wave, unit 4; docs/GEO.md):
 *
 *   - an answer is created only for a planned question, one per question;
 *   - every linked claim must be verified and non-superseded at save and at approval;
 *   - approval goes through the shared approvals context bound to the content hash;
 *     editing the body or the claims detaches it;
 *   - approving the asset answers the question; a superseded claim blocks approval.
 */

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: testDatabaseUrl(),
  REQUIRE_HUMAN_APPROVAL: 'true',
  OUTBOUND_MESSAGING_ENABLED: 'false',
  PII_TO_LLM_ALLOWED: 'false',
  AUTH_COOKIE_SECURE: 'false',
  JWT_SECRET: 'local_test_jwt_secret_0123456789',
  AUTH_COOKIE_PATH: '/',
  CORS_PUBLIC_ORIGINS: 'https://pipupi.ru',
  CORS_APP_ORIGINS: 'https://app.pipupi.ru',
  LLM_PROVIDER: 'fake',
})

const admin = { email: 'geo-answer-admin@pipupi.ru', password: 'geo-answer-admin-password' }

let db: Db
let runtime: Runtime
let accessToken: string

interface JsonBody {
  [key: string]: unknown
}

async function api(method: string, path: string, body?: JsonBody): Promise<Response> {
  return runtime.app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...(method !== 'GET' ? { origin: 'https://app.pipupi.ru' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

async function login(): Promise<void> {
  const response = await runtime.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: admin.password }),
  })
  expect(response.status).toBe(200)
  accessToken = (await bodyOf<{ accessToken: string }>(response)).accessToken
}

async function createPlannedQuery(question: string): Promise<string> {
  const created = await api('POST', '/api/geo/queries', { question, priority: 'high' })
  expect(created.status).toBe(201)
  const queryId = (await bodyOf<{ id: string }>(created)).id
  const planned = await api('PATCH', `/api/geo/queries/${queryId}`, { status: 'planned' })
  expect(planned.status).toBe(200)
  return queryId
}

async function createVerifiedClaim(statement: string): Promise<string> {
  const source = await api('POST', '/api/evidence/sources', {
    title: `Источник: ${statement.slice(0, 30)}`,
    kind: 'producer_document',
  })
  const sourceId = (await bodyOf<{ id: string }>(source)).id
  await api('POST', `/api/evidence/sources/${sourceId}/verify`)

  const claim = await api('POST', '/api/evidence/claims', {
    sourceId,
    statement,
    citations: [{ location: 'Раздел 1' }],
  })
  expect(claim.status).toBe(201)
  const claimId = (await bodyOf<{ id: string }>(claim)).id
  await api('POST', `/api/evidence/claims/${claimId}/verify`)
  return claimId
}

describe('GEO answer assets', () => {
  beforeAll(async () => {
    db = createTestDb()
    await applySeed(db, await loadSeedData())

    const passwords = createPasswordService()
    await db.user.upsert({
      where: { email: admin.email },
      update: { role: 'admin' },
      create: {
        email: admin.email,
        passwordHash: await passwords.hash(admin.password),
        role: 'admin',
      },
    })

    runtime = createRuntime(env)
    await login()
  })

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      await tx.geoAnswerAsset.deleteMany()
      await tx.geoVisibilitySnapshot.deleteMany()
      await tx.geoQuery.deleteMany()
      await tx.citation.deleteMany()
      await tx.claim.deleteMany()
      await tx.evidenceSource.deleteMany()
      await tx.approval.deleteMany()
      await tx.authSession.deleteMany()
    })
    await login()
  })

  afterAll(async () => {
    await db.$transaction(async (tx) => {
      await tx.geoAnswerAsset.deleteMany()
      await tx.geoVisibilitySnapshot.deleteMany()
      await tx.geoQuery.deleteMany()
      await tx.citation.deleteMany()
      await tx.claim.deleteMany()
      await tx.evidenceSource.deleteMany()
      await tx.approval.deleteMany()
      await tx.authSession.deleteMany()
      await tx.user.deleteMany()
    })
    await runtime.close()
    await db.$disconnect()
  })

  test('an answer is created only for a planned question, one per question', async () => {
    const queryId = await createPlannedQuery('Как купить топливо оптом?')

    const created = await api('POST', `/api/geo/queries/${queryId}/answer`, {
      bodyMarkdown: 'Ответ с проверкой фактов.',
      linkedClaimIds: [],
    })
    expect(created.status).toBe(201)
    const answer = await bodyOf<{ id: string; contentHash: string }>(created)
    expect(answer.contentHash).toMatch(/^[a-f0-9]{64}$/)

    const duplicate = await api('POST', `/api/geo/queries/${queryId}/answer`, {
      bodyMarkdown: 'Второй ответ.',
    })
    expect(duplicate.status).toBe(409)
    expect((await bodyOf<{ error: { code: string } }>(duplicate)).error.code).toBe('GEO_ANSWER_EXISTS')

    const openId = (await bodyOf<{ id: string }>(await api('POST', '/api/geo/queries', { question: 'Открытый вопрос.' }))).id
    const premature = await api('POST', `/api/geo/queries/${openId}/answer`, { bodyMarkdown: 'x' })
    expect(premature.status).toBe(409)
    expect((await bodyOf<{ error: { code: string } }>(premature)).error.code).toBe('GEO_QUERY_NOT_PLANNED')
  })

  test('only verified, non-superseded claims can be linked', async () => {
    const queryId = await createPlannedQuery('Какие документы на топливо?')

    const source = await bodyOf<{ id: string }>(
      await api('POST', '/api/evidence/sources', { title: 'Документы производителя', kind: 'producer_document' }),
    )
    const claim = await bodyOf<{ id: string }>(
      await api('POST', '/api/evidence/claims', {
        sourceId: source.id,
        statement: 'Паспорт качества прилагается к каждой партии.',
      }),
    )

    // Unverified claim → refused.
    const unverified = await api('POST', `/api/geo/queries/${queryId}/answer`, {
      bodyMarkdown: 'x',
      linkedClaimIds: [claim.id],
    })
    expect(unverified.status).toBe(422)
    expect((await bodyOf<{ error: { code: string } }>(unverified)).error.code).toBe('GEO_CLAIM_NOT_USABLE')

    await api('POST', `/api/evidence/claims/${claim.id}/verify`)

    // Verified claim → accepted.
    const created = await api('POST', `/api/geo/queries/${queryId}/answer`, {
      bodyMarkdown: 'Паспорт качества прилагается.',
      linkedClaimIds: [claim.id],
    })
    expect(created.status).toBe(201)
  })

  test('approval binds to the hash, answers the question, and an edit detaches it', async () => {
    const queryId = await createPlannedQuery('На чём возите топливо?')
    const claimId = await createVerifiedClaim('Отгрузка выполняется автотранспортом.')

    const created = await api('POST', `/api/geo/queries/${queryId}/answer`, {
      bodyMarkdown: 'Отгрузка выполняется автотранспортом.',
      linkedClaimIds: [claimId],
    })
    const answer = await bodyOf<{ id: string; contentHash: string }>(created)

    const approved = await api('POST', `/api/geo/answers/${answer.id}/approve`, {
      contentHash: answer.contentHash,
    })
    expect(approved.status).toBe(201)

    const listed = await bodyOf<{
      answers: Array<{ id: string; isApproved: boolean; approvalId: string | null }>
    }>(await api('GET', '/api/geo/answers'))
    expect(listed.answers).toHaveLength(1)
    expect(listed.answers[0]?.isApproved).toBe(true)
    expect(listed.answers[0]?.approvalId).not.toBeNull()

    // The question is answered now.
    const queries = await bodyOf<{ queries: Array<{ id: string; status: string }> }>(
      await api('GET', '/api/geo/queries'),
    )
    expect(queries.queries.find((entry) => entry.id === queryId)?.status).toBe('answered')

    // Editing detaches the approval: the old hash is no longer the asset's hash.
    await api('PATCH', `/api/geo/answers/${answer.id}`, { bodyMarkdown: 'Правка текста.' })
    const edited = await bodyOf<{ answers: Array<{ contentHash: string }> }>(
      await api('GET', `/api/geo/answers?queryId=${queryId}`),
    )
    expect(edited.answers[0]?.contentHash).not.toBe(answer.contentHash)

    const stale = await api('POST', `/api/geo/answers/${answer.id}/approve`, {
      contentHash: answer.contentHash,
    })
    expect(stale.status).toBe(409)
    expect((await bodyOf<{ error: { code: string } }>(stale)).error.code).toBe('APPROVAL_STALE')
  })

  test('a superseded claim blocks approval even after a successful save', async () => {
    const queryId = await createPlannedQuery('Суперседнутый факт.')
    const claimId = await createVerifiedClaim('Старая формулировка факта.')

    const created = await api('POST', `/api/geo/queries/${queryId}/answer`, {
      bodyMarkdown: 'Основано на старой формулировке.',
      linkedClaimIds: [claimId],
    })
    const answer = await bodyOf<{ id: string; contentHash: string }>(created)

    await api('POST', `/api/evidence/claims/${claimId}/supersede`, {
      statement: 'Новая формулировка факта.',
    })

    const blocked = await api('POST', `/api/geo/answers/${answer.id}/approve`, {
      contentHash: answer.contentHash,
    })
    expect(blocked.status).toBe(422)
    expect((await bodyOf<{ error: { code: string } }>(blocked)).error.code).toBe('GEO_CLAIM_NOT_USABLE')
  })
})
