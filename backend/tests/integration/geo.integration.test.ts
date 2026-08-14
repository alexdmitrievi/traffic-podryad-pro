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
 * The GEO query inventory against a real database (GEO wave, unit 2; docs/GEO.md):
 *
 *   - a question is recorded and triaged along the lifecycle open → planned → answered;
 *   - a dismissal is terminal, possible at every triage point, and requires a reason;
 *   - answered and dismissed are frozen: no further transition exists;
 *   - roles: readers see the inventory, only admins and editors record and triage.
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

const admin = { email: 'geo-admin@pipupi.ru', password: 'geo-admin-password' }
const viewer = { email: 'geo-viewer@pipupi.ru', password: 'geo-viewer-password' }

let db: Db
let runtime: Runtime
let accessToken: string
let viewerToken: string

interface JsonBody {
  [key: string]: unknown
}

function api(token: string) {
  return async (method: string, path: string, body?: JsonBody): Promise<Response> =>
    runtime.app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(method !== 'GET' ? { origin: 'https://app.pipupi.ru' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
}

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

async function login(email: string, password: string): Promise<string> {
  const response = await runtime.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(response.status).toBe(200)
  return (await bodyOf<{ accessToken: string }>(response)).accessToken
}

async function createQuery(
  call: ReturnType<typeof api>,
  question: string,
): Promise<string> {
  const created = await call('POST', '/api/geo/queries', {
    question,
    priority: 'high',
  })
  expect(created.status).toBe(201)
  return (await bodyOf<{ id: string }>(created)).id
}

describe('the GEO query inventory', () => {
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
    await db.user.upsert({
      where: { email: viewer.email },
      update: { role: 'viewer' },
      create: {
        email: viewer.email,
        passwordHash: await passwords.hash(viewer.password),
        role: 'viewer',
      },
    })

    runtime = createRuntime(env)
    accessToken = await login(admin.email, admin.password)
    viewerToken = await login(viewer.email, viewer.password)
  })

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      await tx.geoQuery.deleteMany()
      await tx.authSession.deleteMany()
    })
    accessToken = await login(admin.email, admin.password)
    viewerToken = await login(viewer.email, viewer.password)
  })

  afterAll(async () => {
    await db.$transaction(async (tx) => {
      await tx.geoQuery.deleteMany()
      await tx.authSession.deleteMany()
      await tx.user.deleteMany()
    })
    await runtime.close()
    await db.$disconnect()
  })

  test('a question travels open → planned → answered', async () => {
    const call = api(accessToken)
    const queryId = await createQuery(call, 'Как купить дизельное топливо оптом в Омске?')

    const planned = await call('PATCH', `/api/geo/queries/${queryId}`, { status: 'planned' })
    expect(planned.status).toBe(200)
    expect((await bodyOf<{ status: string }>(planned)).status).toBe('planned')

    const answered = await call('PATCH', `/api/geo/queries/${queryId}`, { status: 'answered' })
    expect(answered.status).toBe(200)
    expect((await bodyOf<{ status: string }>(answered)).status).toBe('answered')

    const listed = await bodyOf<{ queries: Array<{ id: string; priority: string }> }>(
      await call('GET', '/api/geo/queries?status=answered'),
    )
    expect(listed.queries).toHaveLength(1)
    expect(listed.queries[0]?.id).toBe(queryId)
    expect(listed.queries[0]?.priority).toBe('high')
  })

  test('a dismissal is terminal and requires a reason', async () => {
    const call = api(accessToken)
    const queryId = await createQuery(call, 'Почему цена на мазут меняется каждый день?')

    const noReason = await call('PATCH', `/api/geo/queries/${queryId}`, { status: 'dismissed' })
    expect(noReason.status).toBe(422)
    expect((await bodyOf<{ error: { code: string } }>(noReason)).error.code).toBe('GEO_REASON_REQUIRED')

    const dismissed = await call('PATCH', `/api/geo/queries/${queryId}`, {
      status: 'dismissed',
      statusReason: 'Повтор существующего вопроса.',
    })
    expect(dismissed.status).toBe(200)

    const reopen = await call('PATCH', `/api/geo/queries/${queryId}`, { status: 'planned' })
    expect(reopen.status).toBe(409)
    expect((await bodyOf<{ error: { code: string } }>(reopen)).error.code).toBe('GEO_TRANSITION_NOT_ALLOWED')
  })

  test('answered is frozen as well', async () => {
    const call = api(accessToken)
    const queryId = await createQuery(call, 'Какие регионы СФО есть в поставках?')
    await call('PATCH', `/api/geo/queries/${queryId}`, { status: 'planned' })
    await call('PATCH', `/api/geo/queries/${queryId}`, { status: 'answered' })

    const move = await call('PATCH', `/api/geo/queries/${queryId}`, { status: 'dismissed', statusReason: 'x' })
    expect(move.status).toBe(409)
  })

  test('priority moves without touching the status', async () => {
    const call = api(accessToken)
    const queryId = await createQuery(call, 'Отгружаете ли вы в Иркутск зимой?')

    const raised = await call('PATCH', `/api/geo/queries/${queryId}`, { priority: 'high' })
    expect(raised.status).toBe(200)
    const updated = await bodyOf<{ priority: string; status: string }>(raised)
    expect(updated.priority).toBe('high')
    expect(updated.status).toBe('open')
  })

  test('readers see the inventory but cannot record or triage', async () => {
    const adminCall = api(accessToken)
    await createQuery(adminCall, 'Вопрос администратора для фильтра.')

    const read = api(viewerToken)
    expect((await read('GET', '/api/geo/queries')).status).toBe(200)
    expect((await read('POST', '/api/geo/queries', { question: 'Чужой вопрос' })).status).toBe(403)
  })

  test('anonymous access is refused', async () => {
    const anon = api('')
    expect((await anon('GET', '/api/geo/queries')).status).toBe(401)
  })
})
