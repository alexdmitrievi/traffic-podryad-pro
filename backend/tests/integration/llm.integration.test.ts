import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { loadEnv } from '../../src/env'
import { createRuntime } from '../../src/runtime'
import type { Runtime } from '../../src/runtime'
import { createTestDb, testDatabaseUrl } from './helpers'
import type { Db } from '../../src/db'
// The seed is plain JavaScript on purpose: `seed:check` runs in CI before `prisma
// generate`, so the module must not statically import the generated client.
// @ts-expect-error — JavaScript module without a declaration file
import { applySeed, loadSeedData } from '../../prisma/seed/index.mjs'
import { LlmBudgetExceededError, createInstrumentedLlmPort } from '../../src/providers/llm/instrumentation'
import { LlmGuardError } from '../../src/providers/llm/pii-guard'
import { createFakeLlmDriver } from '../../src/providers/llm/fake-driver'

/**
 * LlmRun recording against a real database: every call leaves a row, personal data is
 * refused before anything is recorded, and the monthly cost cap stops generation with a
 * recorded skip.
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

const cleanBrief = {
  keywords: ['дизельное топливо оптом'],
  clusterTitle: 'Оптовая покупка дизельного топлива',
  productNames: ['Дизельное топливо'],
  regionNames: ['Омск'],
  audience: null,
  tone: null,
  instructions: ['Не выдумывать характеристики.'],
}

/**
 * Awaiting a rejection explicitly: bun's `.rejects` matcher hangs on promise rejections
 * that settle after database round-trips, so the assertions below use the honest form.
 */
async function rejectionOf(
  promise: Promise<unknown>,
): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

let db: Db
let runtime: Runtime

describe('llm_runs recording', () => {
  beforeAll(async () => {
    db = createTestDb()
    const data = await loadSeedData()
    await applySeed(db, data)
    runtime = createRuntime(env)
  })

  beforeEach(async () => {
    await db.llmRun.deleteMany()
  })

  afterAll(async () => {
    await runtime.close()
    await db.$disconnect()
  })

  test('a successful call writes an llm_runs row with a prompt hash, never the prompt', async () => {
    await runtime.llm.generateBrief(cleanBrief)

    const runs = await db.llmRun.findMany()
    expect(runs).toHaveLength(1)
    expect(runs[0]?.purpose).toBe('brief_generation')
    expect(runs[0]?.status).toBe('succeeded')
    expect(runs[0]?.promptHash).toMatch(/^[0-9a-f]{64}$/)
    expect(runs[0]?.provider).toBe('fake')

    // The prompt text itself is never stored — by construction of the schema.
    const serialized = JSON.stringify(runs[0])
    expect(serialized).not.toContain('дизельное')
  })

  test('personal data is refused before any row is recorded', async () => {
    const rejection = await rejectionOf(
      runtime.llm.generateBrief({
        ...cleanBrief,
        instructions: ['Связаться с покупателем: buyer@company.ru'],
      }),
    )

    expect(rejection).toBeInstanceOf(LlmGuardError)
    expect(await db.llmRun.count()).toBe(0)
  })

  test('the monthly cost cap stops generation and records the skip', async () => {
    const instrumented = createInstrumentedLlmPort(createFakeLlmDriver(), {
      db,
      provider: 'fake',
      model: 'fake-deterministic',
      workspaceSlug: 'pipupi',
      monthlyCapMinorUnits: 50,
    })

    // Seed recorded spend past the cap.
    const workspace = await db.workspace.findUniqueOrThrow({ where: { slug: 'pipupi' } })
    await db.llmRun.create({
      data: {
        workspaceId: workspace.id,
        provider: 'fake',
        model: 'fake-deterministic',
        purpose: 'brief_generation',
        promptHash: 'a'.repeat(64),
        costMinorUnits: 100,
        costCurrency: 'RUB',
        status: 'succeeded',
      },
    })

    const rejection = await rejectionOf(instrumented.generateBrief(cleanBrief))
    expect(rejection).toBeInstanceOf(LlmBudgetExceededError)

    const skipped = await db.llmRun.findFirstOrThrow({
      where: { status: 'skipped', errorCode: 'LLM_BUDGET_EXCEEDED' },
    })
    expect(skipped.purpose).toBe('brief_generation')
  })

  test('an uncapped recorder keeps going', async () => {
    const instrumented = createInstrumentedLlmPort(createFakeLlmDriver(), {
      db,
      provider: 'fake',
      model: 'fake-deterministic',
      workspaceSlug: 'pipupi',
      monthlyCapMinorUnits: null,
    })

    const result = await instrumented.generateBrief(cleanBrief)
    expect(result.content.title).toContain(cleanBrief.clusterTitle)
  })
})
