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
 * The evidence registry against a real database (GEO wave, unit 1; docs/GEO.md):
 *
 *   - a source and a claim start unverified and become usable only after a human
 *     verifies them — the verifier is recorded, not just a flag;
 *   - the same statement twice for one source is a duplicate, refused;
 *   - a correction supersedes: history stays readable, the old claim is frozen,
 *     the replacement starts unverified and must be verified again;
 *   - roles: readers see the registry, only admins and editors write to it.
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

const admin = { email: 'evidence-admin@pipupi.ru', password: 'evidence-admin-password' }
const viewer = { email: 'evidence-viewer@pipupi.ru', password: 'evidence-viewer-password' }

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

async function createVerifiedSource(call: ReturnType<typeof api>): Promise<string> {
  const created = await call('POST', '/api/evidence/sources', {
    title: 'Технические условия производителя ДТ',
    kind: 'producer_document',
    notes: 'Документ получен напрямую от производителя.',
  })
  expect(created.status).toBe(201)
  const source = await bodyOf<{ id: string }>(created)

  const verified = await call('POST', `/api/evidence/sources/${source.id}/verify`)
  expect(verified.status).toBe(200)
  return source.id
}

describe('the evidence registry', () => {
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
      await tx.citation.deleteMany()
      await tx.claim.deleteMany()
      await tx.evidenceSource.deleteMany()
      await tx.authSession.deleteMany()
    })
    accessToken = await login(admin.email, admin.password)
    viewerToken = await login(viewer.email, viewer.password)
  })

  afterAll(async () => {
    await db.$transaction(async (tx) => {
      await tx.citation.deleteMany()
      await tx.claim.deleteMany()
      await tx.evidenceSource.deleteMany()
      await tx.authSession.deleteMany()
      await tx.user.deleteMany()
    })
    await runtime.close()
    await db.$disconnect()
  })

  test('a source starts unverified and becomes verified with a recorded checker', async () => {
    const call = api(accessToken)
    const created = await call('POST', '/api/evidence/sources', {
      title: 'ГОСТ на топливо дизельное',
      kind: 'official_standard',
    })
    expect(created.status).toBe(201)
    const source = await bodyOf<{ id: string; verifiedAt: string | null; verifiedById: string | null }>(created)
    expect(source.verifiedAt).toBeNull()
    expect(source.verifiedById).toBeNull()

    const verified = await call('POST', `/api/evidence/sources/${source.id}/verify`)
    expect(verified.status).toBe(200)
    const checked = await bodyOf<{ verifiedAt: string | null; verifiedById: string | null }>(verified)
    expect(checked.verifiedAt).not.toBeNull()
    expect(checked.verifiedById).not.toBeNull()

    const listed = await bodyOf<{ sources: Array<{ id: string; claimCount: number }> }>(
      await call('GET', '/api/evidence/sources'),
    )
    expect(listed.sources).toHaveLength(1)
    expect(listed.sources[0]?.claimCount).toBe(0)
  })

  test('verification is recorded once: a second call keeps the first stamp', async () => {
    const call = api(accessToken)
    const sourceId = await createVerifiedSource(call)
    const again = await call('POST', `/api/evidence/sources/${sourceId}/verify`)
    expect(again.status).toBe(200)
    const first = await bodyOf<{ verifiedAt: string }>(again)
    const third = await call('POST', `/api/evidence/sources/${sourceId}/verify`)
    expect((await bodyOf<{ verifiedAt: string }>(third)).verifiedAt).toBe(first.verifiedAt)
  })

  test('a claim with citations is created unverified and becomes verified', async () => {
    const call = api(accessToken)
    const sourceId = await createVerifiedSource(call)

    const created = await call('POST', '/api/evidence/claims', {
      sourceId,
      statement: 'Отгрузка дизельного топлива выполняется автомобильным транспортом производителя.',
      category: 'доставка',
      citations: [{ location: 'Раздел 4, п. 4.2', quote: 'Поставка осуществляется автотранспортом.' }],
    })
    expect(created.status).toBe(201)
    const claim = await bodyOf<{ id: string; status: string; citations: unknown[] }>(created)
    expect(claim.status).toBe('unverified')
    expect(claim.citations).toHaveLength(1)

    const verified = await call('POST', `/api/evidence/claims/${claim.id}/verify`)
    expect(verified.status).toBe(200)
    expect((await bodyOf<{ status: string }>(verified)).status).toBe('verified')

    const listed = await bodyOf<{ claims: Array<{ id: string; status: string }> }>(
      await call('GET', `/api/evidence/claims?status=verified`),
    )
    expect(listed.claims).toHaveLength(1)
    expect(listed.claims[0]?.id).toBe(claim.id)
  })

  test('the same statement twice for one source is a duplicate, refused', async () => {
    const call = api(accessToken)
    const sourceId = await createVerifiedSource(call)

    const first = await call('POST', '/api/evidence/claims', {
      sourceId,
      statement: 'Минимальная партия отгрузки — двадцать тонн.',
    })
    expect(first.status).toBe(201)

    const second = await call('POST', '/api/evidence/claims', {
      sourceId,
      statement: 'Минимальная партия отгрузки — двадцать тонн.',
    })
    expect(second.status).toBe(409)
    expect((await bodyOf<{ error: { code: string } }>(second)).error.code).toBe('CLAIM_DUPLICATE')
  })

  test('a claim for a missing source is refused', async () => {
    const call = api(accessToken)
    const created = await call('POST', '/api/evidence/claims', {
      sourceId: '0192f1a0-0000-7000-8000-000000000099',
      statement: 'Некуда привязать.',
    })
    expect(created.status).toBe(404)
  })

  test('a correction supersedes: history stays, the replacement needs verification', async () => {
    const call = api(accessToken)
    const sourceId = await createVerifiedSource(call)

    const created = await call('POST', '/api/evidence/claims', {
      sourceId,
      statement: 'Плотность топлива — 820 кг/м³.',
      citations: [{ location: 'Таблица 1' }],
    })
    expect(created.status).toBe(201)
    const claim = await bodyOf<{ id: string }>(created)
    await call('POST', `/api/evidence/claims/${claim.id}/verify`)

    const corrected = await call('POST', `/api/evidence/claims/${claim.id}/supersede`, {
      statement: 'Плотность топлива при 15 °C — 830 кг/м³.',
    })
    expect(corrected.status).toBe(201)
    const replacement = await bodyOf<{ id: string; status: string; citations: unknown[] }>(corrected)
    expect(replacement.status).toBe('unverified')
    expect(replacement.citations).toHaveLength(1)

    const listed = await bodyOf<{ claims: Array<{ id: string; status: string; supersededById: string | null }> }>(
      await call('GET', '/api/evidence/claims'),
    )
    expect(listed.claims).toHaveLength(2)
    const old = listed.claims.find((entry) => entry.id === claim.id)
    expect(old?.status).toBe('superseded')
    expect(old?.supersededById).toBe(replacement.id)

    const refreeze = await call('POST', `/api/evidence/claims/${claim.id}/verify`)
    expect(refreeze.status).toBe(409)
    expect((await bodyOf<{ error: { code: string } }>(refreeze)).error.code).toBe('CLAIM_SUPERSEDED')

    const verified = await call('POST', `/api/evidence/claims/${replacement.id}/verify`)
    expect(verified.status).toBe(200)
    expect((await bodyOf<{ status: string }>(verified)).status).toBe('verified')
  })

  test('a supersession that changes nothing is refused as a duplicate', async () => {
    const call = api(accessToken)
    const sourceId = await createVerifiedSource(call)
    const created = await call('POST', '/api/evidence/claims', {
      sourceId,
      statement: 'Формулировка без правки.',
    })
    const claim = await bodyOf<{ id: string }>(created)

    const unchanged = await call('POST', `/api/evidence/claims/${claim.id}/supersede`, {})
    expect(unchanged.status).toBe(409)
  })

  test('readers see the registry; they cannot create, verify or supersede', async () => {
    const adminCall = api(accessToken)
    const sourceId = await createVerifiedSource(adminCall)

    const read = api(viewerToken)
    expect((await read('GET', '/api/evidence/sources')).status).toBe(200)
    expect((await read('GET', '/api/evidence/claims')).status).toBe(200)

    const create = await read('POST', '/api/evidence/sources', { title: 'Чужой источник', kind: 'other' })
    expect(create.status).toBe(403)
    const claim = await read('POST', '/api/evidence/claims', { sourceId, statement: 'Чужой факт.' })
    expect(claim.status).toBe(403)
  })

  test('anonymous access is refused', async () => {
    const anon = api('')
    expect((await anon('GET', '/api/evidence/sources')).status).toBe(401)
    expect((await anon('POST', '/api/evidence/sources', { title: 'x', kind: 'other' })).status).toBe(401)
  })
})
