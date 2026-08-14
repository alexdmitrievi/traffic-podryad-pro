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
 * The product pipeline against a real database — the acceptance criteria of unit 4d
 * (docs/WAVE_4_DELEGATION.md section 4d):
 *
 *   - publication without an approval is refused (the key negative test);
 *   - editing after approval detaches it and blocks publication of the new revision;
 *   - planning-only lines terminate in planned_awaiting_capability with no path to
 *     in_delivery;
 *   - a complex package decomposes and reaches partially_delivered;
 *   - every transition writes an event; rejected/on_hold/cancelled require a reason;
 *   - a lead without consent is rejected server-side; a repeat submission adds a touch.
 *
 * The LLM runs on the deterministic fake driver; the worker is simulated by draining the
 * outbox with the wired handlers — the same registry the worker entrypoint uses.
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

const admin = { email: 'pipeline-admin@pipupi.ru', password: 'pipeline-admin-password' }

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

async function publicApi(method: string, path: string, body?: JsonBody): Promise<Response> {
  return runtime.app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(method !== 'GET' ? { origin: 'https://pipupi.ru' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

async function runSeoRequestToPlanning(): Promise<string> {
  const created = await api('POST', '/api/service-requests', {
    serviceLine: 'seo_content',
    title: 'SEO по оптовым запросам ДТ',
    objective: 'Собрать органический трафик.',
  })
  expect(created.status).toBe(201)
  const id = (await bodyOf<{ id: string }>(created)).id

  for (const status of ['submitted', 'triage', 'accepted', 'planning']) {
    const moved = await api('POST', `/api/service-requests/${id}/status`, { status })
    expect(moved.status).toBe(200)
  }

  const plan = await api('POST', `/api/service-requests/${id}/plans`, {
    requestId: id,
    content: {
      kind: 'seo_content',
      goals: ['Органика по оптовым запросам.'],
      plannedArticleCount: 1,
    },
  })
  expect(plan.status).toBe(201)
  const planBody = await bodyOf<{ id: string; contentHash: string }>(plan)

  const approved = await api('POST', `/api/service-requests/${id}/approve-plan`, {
    planId: planBody.id,
    contentHash: planBody.contentHash,
    decision: 'approved',
  })
  expect(approved.status).toBe(200)

  const delivering = await api('POST', `/api/service-requests/${id}/status`, { status: 'in_delivery' })
  expect(delivering.status).toBe(200)

  return id
}

describe('the product pipeline', () => {
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
    const login = await runtime.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: admin.password }),
    })
    accessToken = (await bodyOf<{ accessToken: string }>(login)).accessToken
  })

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      await tx.attributionTouch.deleteMany()
      await tx.lead.deleteMany()
      await tx.publication.deleteMany()
      await tx.approval.deleteMany()
      await tx.contentRevision.deleteMany()
      await tx.contentItem.deleteMany()
      await tx.contentBrief.deleteMany()
      await tx.clusterKeyword.deleteMany()
      await tx.topicCluster.deleteMany()
      await tx.keywordMetric.deleteMany()
      await tx.keyword.deleteMany()
      await tx.serviceRequestPlan.deleteMany()
      await tx.serviceRequestEvent.deleteMany()
      await tx.serviceRequest.deleteMany()
      await tx.llmRun.deleteMany()
      await tx.authSession.deleteMany()
    })
    await runtime.drainOutboxOnce()

    // The cleanup wipes sessions; the admin re-authenticates for this test.
    const login = await runtime.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: admin.password }),
    })
    expect(login.status).toBe(200)
    accessToken = (await bodyOf<{ accessToken: string }>(login)).accessToken
  })

  afterAll(async () => {
    await db.$transaction(async (tx) => {
      await tx.attributionTouch.deleteMany()
      await tx.lead.deleteMany()
      await tx.publication.deleteMany()
      await tx.approval.deleteMany()
      await tx.contentRevision.deleteMany()
      await tx.contentItem.deleteMany()
      await tx.contentBrief.deleteMany()
      await tx.clusterKeyword.deleteMany()
      await tx.topicCluster.deleteMany()
      await tx.keywordMetric.deleteMany()
      await tx.keyword.deleteMany()
      await tx.serviceRequestPlan.deleteMany()
      await tx.serviceRequestEvent.deleteMany()
      await tx.serviceRequest.deleteMany()
      await tx.llmRun.deleteMany()
      await tx.authSession.deleteMany()
      await tx.user.deleteMany()
    })
    await runtime.close()
    await db.$disconnect()
  })

  test('publication without an approval is refused — the central negative test', async () => {
    const requestId = await runSeoRequestToPlanning()

    const imported = await api('POST', '/api/research/imports', {
      requestId,
      csv: ['phrase,volume', 'дизельное топливо оптом омск,320', 'купить дт тюмень,40'].join('\n'),
    })
    expect(imported.status).toBe(200)

    const clustered = await api('POST', '/api/research/clusters', { requestId })
    expect(clustered.status).toBe(201)
    const clusters = await bodyOf<{ clusters: Array<{ id: string }> }>(
      await api('GET', `/api/research/clusters?requestId=${requestId}`),
    )
    expect(clusters.clusters.length).toBeGreaterThan(0)

    const brief = await api('POST', '/api/content/briefs', { clusterId: clusters.clusters[0]!.id })
    expect(brief.status).toBe(201)
    const briefId = (await bodyOf<{ id: string }>(brief)).id

    await runtime.drainOutboxOnce()
    const reviewed = await api('POST', `/api/content/briefs/${briefId}/review`, { decision: 'approve' })
    expect(reviewed.status).toBe(200)

    const item = await api('POST', '/api/content/items', { briefId })
    expect(item.status).toBe(201)
    const itemId = (await bodyOf<{ id: string }>(item)).id

    await runtime.drainOutboxOnce()
    const fetched = await bodyOf<{
      revisions: Array<{ id: string; contentHash: string; authorKind: string }>
    }>(await api('GET', `/api/content/items/${itemId}`))
    const revision = fetched.revisions[0]!
    expect(revision.authorKind).toBe('llm')

    // THE negative test: no approval → publication refused, no row written.
    const denied = await api('POST', '/api/publications', { contentItemId: itemId, revisionId: revision.id })
    expect(denied.status).toBe(409)
    expect(await bodyOf<{ error: { code: string } }>(denied)).toHaveProperty('error.code', 'APPROVAL_REQUIRED')
    expect(await db.publication.count()).toBe(0)

    // An approval with a foreign hash is refused too.
    const stale = await api('POST', '/api/approvals', {
      subjectType: 'content_revision',
      subjectId: revision.id,
      contentHash: 'a'.repeat(64),
      decision: 'approved',
    })
    expect(stale.status).toBe(409)

    // Approve the exact revision, then publish.
    const approval = await api('POST', '/api/approvals', {
      subjectType: 'content_revision',
      subjectId: revision.id,
      contentHash: revision.contentHash,
      decision: 'approved',
    })
    expect(approval.status).toBe(201)

    const published = await api('POST', '/api/publications', { contentItemId: itemId, revisionId: revision.id })
    expect(published.status).toBe(201)
    const publicationId = (await bodyOf<{ id: string }>(published)).id

    await runtime.drainOutboxOnce()
    const publication = await db.publication.findUniqueOrThrow({ where: { id: publicationId } })
    expect(publication.status).toBe('published')
    expect(publication.publicUrl).toContain('pipupi.ru')

    const rendered = await Bun.file(`.storage/public/${publication.publicUrl!.split('/').pop()}.html`).text()
    expect(rendered).toContain('<title>')
    expect(rendered).toContain('name="description"')
    expect(rendered).toContain('rel="canonical"')
    expect(rendered).toContain('application/ld+json')
  })

  test('editing after approval detaches it and blocks the new revision', async () => {
    const requestId = await runSeoRequestToPlanning()
    await api('POST', '/api/research/imports', {
      requestId,
      csv: ['phrase', 'мазут оптом'].join('\n'),
    })
    await api('POST', '/api/research/clusters', { requestId })
    const clusters = await bodyOf<{ clusters: Array<{ id: string }> }>(
      await api('GET', `/api/research/clusters?requestId=${requestId}`),
    )
    const brief = await api('POST', '/api/content/briefs', { clusterId: clusters.clusters[0]!.id })
    const briefId = (await bodyOf<{ id: string }>(brief)).id
    await runtime.drainOutboxOnce()
    await api('POST', `/api/content/briefs/${briefId}/review`, { decision: 'approve' })
    const item = await api('POST', '/api/content/items', { briefId })
    const itemId = (await bodyOf<{ id: string }>(item)).id
    await runtime.drainOutboxOnce()

    const first = await bodyOf<{ revisions: Array<{ id: string; contentHash: string }> }>(
      await api('GET', `/api/content/items/${itemId}`),
    )
    const firstRevision = first.revisions[0]!
    await api('POST', '/api/approvals', {
      subjectType: 'content_revision',
      subjectId: firstRevision.id,
      contentHash: firstRevision.contentHash,
      decision: 'approved',
    })

    // A human edit creates a new revision with a new hash.
    const edited = await api('POST', `/api/content/items/${itemId}/revisions`, {
      contentItemId: itemId,
      bodyMarkdown: '# Исправленный текст\n\nДругое содержание.',
    })
    expect(edited.status).toBe(201)
    const secondRevision = await bodyOf<{ id: string; contentHash: string }>(edited)

    // The approved revision still publishes; the edited one is blocked.
    const allowed = await api('POST', '/api/publications', { contentItemId: itemId, revisionId: firstRevision.id })
    expect(allowed.status).toBe(201)

    const blocked = await api('POST', '/api/publications', { contentItemId: itemId, revisionId: secondRevision.id })
    expect(blocked.status).toBe(409)
    expect(await bodyOf<{ error: { code: string } }>(blocked)).toHaveProperty('error.code', 'APPROVAL_REQUIRED')
  })

  test('b2b_outreach and telegram_marketing terminate in planned_awaiting_capability with no delivery path', async () => {
    for (const line of ['b2b_outreach', 'telegram_marketing'] as const) {
      const created = await api('POST', '/api/service-requests', {
        serviceLine: line,
        title: `Планирование: ${line}`,
        objective: 'Подготовить план.',
      })
      const id = (await bodyOf<{ id: string }>(created)).id

      for (const status of ['submitted', 'triage', 'accepted', 'planning']) {
        expect((await api('POST', `/api/service-requests/${id}/status`, { status })).status).toBe(200)
      }

      const planContent =
        line === 'b2b_outreach'
          ? {
              kind: 'b2b_outreach',
              idealCustomerProfile: 'Автопарки от 20 единиц техники.',
              segments: [{ name: 'Автопарки СФО', traits: ['транспорт'], estimatedSize: null }],
              valueHypotheses: ['Стабильность поставки.'],
              assumedLegalBasis: 'Требуется заключение юриста.',
            }
          : {
              kind: 'telegram_marketing',
              channelConcept: 'Канал о логистике ГСМ.',
              optInMechanics: 'Пользователь сам нажимает /start.',
            }

      const plan = await api('POST', `/api/service-requests/${id}/plans`, { requestId: id, content: planContent })
      expect(plan.status).toBe(201)
      const planBody = await bodyOf<{ id: string; contentHash: string }>(plan)

      const approved = await api('POST', `/api/service-requests/${id}/approve-plan`, {
        planId: planBody.id,
        contentHash: planBody.contentHash,
        decision: 'approved',
      })
      expect(approved.status).toBe(200)

      // The orchestration moved the request to the terminal capability state.
      const request = await db.serviceRequest.findUniqueOrThrow({ where: { id } })
      expect(request.status).toBe('planned_awaiting_capability')

      // There is no path to delivery for this line — the capability gate refuses it.
      const delivering = await api('POST', `/api/service-requests/${id}/status`, { status: 'in_delivery' })
      expect(delivering.status).toBe(409)
    }
  })

  test('a complex package decomposes and reaches partially_delivered', async () => {
    const created = await api('POST', '/api/service-requests', {
      serviceLine: 'complex_package',
      title: 'Комплексный пакет',
      objective: 'SEO + Telegram.',
    })
    const parentId = (await bodyOf<{ id: string }>(created)).id

    for (const status of ['submitted', 'triage', 'accepted', 'planning']) {
      expect((await api('POST', `/api/service-requests/${parentId}/status`, { status })).status).toBe(200)
    }

    const plan = await api('POST', `/api/service-requests/${parentId}/plans`, {
      requestId: parentId,
      content: {
        kind: 'complex_package',
        overallGoal: 'Выход на рынок.',
        childRequests: [
          { serviceLine: 'seo_content', title: 'SEO-часть', objective: 'Органика.' },
          { serviceLine: 'telegram_marketing', title: 'Telegram-часть', objective: 'Планирование канала.' },
        ],
      },
    })
    expect(plan.status).toBe(201)
    const planBody = await bodyOf<{ id: string; contentHash: string }>(plan)

    const approved = await api('POST', `/api/service-requests/${parentId}/approve-plan`, {
      planId: planBody.id,
      contentHash: planBody.contentHash,
      decision: 'approved',
    })
    expect(approved.status).toBe(200)

    const decomposed = await api('POST', `/api/service-requests/${parentId}/decompose`, {})
    expect(decomposed.status).toBe(200)

    const children = await db.serviceRequest.findMany({ where: { parentRequestId: parentId } })
    expect(children).toHaveLength(2)

    // The SEO child delivers fully.
    const seoChild = children.find((child) => child.serviceLine === 'seo_content')!
    for (const status of ['triage', 'accepted', 'planning']) {
      expect((await api('POST', `/api/service-requests/${seoChild.id}/status`, { status })).status).toBe(200)
    }
    const seoPlan = await api('POST', `/api/service-requests/${seoChild.id}/plans`, {
      requestId: seoChild.id,
      content: { kind: 'seo_content', goals: ['Органика.'], plannedArticleCount: 1 },
    })
    const seoPlanBody = await bodyOf<{ id: string; contentHash: string }>(seoPlan)
    await api('POST', `/api/service-requests/${seoChild.id}/approve-plan`, {
      planId: seoPlanBody.id,
      contentHash: seoPlanBody.contentHash,
      decision: 'approved',
    })
    expect((await api('POST', `/api/service-requests/${seoChild.id}/status`, { status: 'in_delivery' })).status).toBe(200)
    expect((await api('POST', `/api/service-requests/${seoChild.id}/status`, { status: 'delivered' })).status).toBe(200)

    // The telegram child reaches the capability state.
    const telegramChild = children.find((child) => child.serviceLine === 'telegram_marketing')!
    for (const status of ['triage', 'accepted', 'planning']) {
      expect((await api('POST', `/api/service-requests/${telegramChild.id}/status`, { status })).status).toBe(200)
    }
    const tgPlan = await api('POST', `/api/service-requests/${telegramChild.id}/plans`, {
      requestId: telegramChild.id,
      content: { kind: 'telegram_marketing', channelConcept: 'Канал.', optInMechanics: '/start' },
    })
    const tgPlanBody = await bodyOf<{ id: string; contentHash: string }>(tgPlan)
    await api('POST', `/api/service-requests/${telegramChild.id}/approve-plan`, {
      planId: tgPlanBody.id,
      contentHash: tgPlanBody.contentHash,
      decision: 'approved',
    })

    const parent = await db.serviceRequest.findUniqueOrThrow({ where: { id: parentId } })
    expect(parent.status).toBe('partially_delivered')
  })

  test('transitions write events, and rejected/on_hold/cancelled require a reason', async () => {
    const created = await api('POST', '/api/service-requests', {
      serviceLine: 'seo_content',
      title: 'Переходы',
      objective: 'Проверка переходов.',
    })
    const id = (await bodyOf<{ id: string }>(created)).id

    for (const status of ['submitted', 'triage']) {
      expect((await api('POST', `/api/service-requests/${id}/status`, { status })).status).toBe(200)
    }

    const noReason = await api('POST', `/api/service-requests/${id}/status`, { status: 'rejected' })
    expect(noReason.status).toBe(400)

    const withReason = await api('POST', `/api/service-requests/${id}/status`, { status: 'rejected', reason: 'вне профиля' })
    expect(withReason.status).toBe(200)

    const events = await db.serviceRequestEvent.findMany({ where: { requestId: id }, orderBy: { occurredAt: 'asc' } })
    expect(events.map((event) => event.toStatus)).toEqual(['draft', 'submitted', 'triage', 'rejected'])
  })

  test('a lead without consent is rejected server-side; a repeat submission adds a touch', async () => {
    const requestId = await runSeoRequestToPlanning()
    await api('POST', '/api/research/imports', { requestId, csv: ['phrase', 'дизель оптом'].join('\n') })
    await api('POST', '/api/research/clusters', { requestId })
    const clusters = await bodyOf<{ clusters: Array<{ id: string }> }>(
      await api('GET', `/api/research/clusters?requestId=${requestId}`),
    )
    const brief = await api('POST', '/api/content/briefs', { clusterId: clusters.clusters[0]!.id })
    const briefId = (await bodyOf<{ id: string }>(brief)).id
    await runtime.drainOutboxOnce()
    await api('POST', `/api/content/briefs/${briefId}/review`, { decision: 'approve' })
    const item = await api('POST', '/api/content/items', { briefId })
    const itemId = (await bodyOf<{ id: string }>(item)).id
    await runtime.drainOutboxOnce()
    const fetched = await bodyOf<{ revisions: Array<{ id: string; contentHash: string }> }>(
      await api('GET', `/api/content/items/${itemId}`),
    )
    const revision = fetched.revisions[0]!
    await api('POST', '/api/approvals', {
      subjectType: 'content_revision',
      subjectId: revision.id,
      contentHash: revision.contentHash,
      decision: 'approved',
    })
    await api('POST', '/api/publications', { contentItemId: itemId, revisionId: revision.id })
    await runtime.drainOutboxOnce()

    const visitorId = crypto.randomUUID()
    const touch = await publicApi('POST', '/api/public/touches', {
      visitorId,
      path: '/blog/some-slug',
      contentItemId: itemId,
      utmSource: 'dzen',
    })
    expect(touch.status).toBe(200)

    // Without consent: rejected by the server, no lead stored.
    const withoutConsent = await publicApi('POST', '/api/public/leads', {
      contactName: 'Алексей',
      phone: '79001234567',
      visitorId,
    })
    expect(withoutConsent.status).toBe(400)
    expect(await db.lead.count()).toBe(0)

    // With consent: stored, touches linked.
    const leadBody = {
      contactName: 'Алексей',
      phone: '79001234567',
      visitorId,
      landingPath: '/blog/some-slug',
      contentItemId: itemId,
      utmSource: 'dzen',
      consent: true,
      consentTextVersion: '2026-08-01',
      privacyPolicyVersion: '2026-08-01',
    }
    const accepted = await publicApi('POST', '/api/public/leads', leadBody)
    expect(accepted.status).toBe(200)
    expect(await db.lead.count()).toBe(1)

    const lead = await db.lead.findFirstOrThrow({ include: { touches: true } })
    expect(lead.touches.length).toBe(1)
    expect(lead.touches[0]?.position).toBe('first')

    // The honeypot drops a bot quietly — same accepted, nothing stored.
    const before = await db.lead.count()
    const bot = await publicApi('POST', '/api/public/leads', { ...leadBody, website: 'spam', phone: '79009998877' })
    expect(bot.status).toBe(200)
    expect(await db.lead.count()).toBe(before)

    // A repeat submission of the same contact adds a touch, not a second lead.
    const repeat = await publicApi('POST', '/api/public/leads', leadBody)
    expect(repeat.status).toBe(200)
    expect(await db.lead.count()).toBe(1)
    const afterRepeat = await db.lead.findFirstOrThrow({ include: { touches: true } })
    expect(afterRepeat.touches.length).toBe(2)
    expect(afterRepeat.touches.some((entry) => entry.position === 'last')).toBe(true)

    // The attribution chain closes: lead → touch → item → cluster → keyword → product → region.
    const chainResponse = await api('GET', `/api/attribution/leads/${lead.id}/attribution`)
    expect(chainResponse.status).toBe(200)
    const chain = await bodyOf<{
      contentItemId: string | null
      contentTitle: string | null
      clusterId: string | null
      keywordId: string | null
      keywordPhrase: string | null
    }>(chainResponse)
    expect(chain.contentItemId).toBe(itemId)
    expect(chain.contentTitle).not.toBeNull()
    expect(chain.clusterId).not.toBeNull()
    expect(chain.keywordId).not.toBeNull()
    expect(chain.keywordPhrase).not.toBeNull()

    // The funnel screen has honest numbers.
    const funnelResponse = await api('GET', '/api/analytics/funnel')
    expect(funnelResponse.status).toBe(200)
    const funnel = await bodyOf<{ publishedContentCount: number; leadCount: number; attributedLeadCount: number }>(funnelResponse)
    expect(funnel.publishedContentCount).toBeGreaterThanOrEqual(1)
    expect(funnel.leadCount).toBe(1)
    expect(funnel.attributedLeadCount).toBe(1)
  })
})
