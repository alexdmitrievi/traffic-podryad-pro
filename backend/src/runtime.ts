/**
 * The composition root: wires environment, database, outbox, health app, the background
 * runners and every product module into one runtime object that all entrypoints share
 * (docs/ARCHITECTURE.md section 1 — one code base, one image, several entry points).
 *
 * The task handler registry here is what the worker drains: brief generation, draft
 * generation and publication travel through the durable outbox, and the handlers come
 * from the modules that own them.
 */

import { createApp } from './app'
import { createDb, migrationsApplied, pingDatabase } from './db'
import type { Env } from './env'
import { jobs } from './jobs'
import { createAuthModule, createSessionCleanup } from './modules/auth'
import { createUsersModule } from './modules/users'
import { createServiceRequestsModule } from './modules/service-requests'
import { createApprovalsModule } from './modules/approvals'
import type { SubjectHashProvider } from './modules/approvals'
import { createResearchModule } from './modules/research'
import { createContentModule } from './modules/content'
import { createPublishingModule } from './modules/publishing'
import { createLeadsModule } from './modules/leads'
import { createAttributionModule } from './modules/attribution'
import { createAnalyticsModule } from './modules/analytics'
import { createEvidenceModule } from './modules/evidence'
import { createGeoModule } from './modules/geo'
import { createRateLimiter } from './http/rate-limiter'
import { createDrainLoop, drainOnce } from './outbox/drain-loop'
import type { DrainLoop, TaskHandlerRegistry } from './outbox/drain-loop'
import { createOutbox } from './outbox/outbox-service'
import type { Outbox } from './outbox/outbox-service'
import { createDeepseekDriver } from './providers/llm/deepseek-driver'
import { createFakeLlmDriver } from './providers/llm/fake-driver'
import { createInstrumentedLlmPort } from './providers/llm/instrumentation'
import { createGuardedLlmPort } from './providers/llm/pii-guard'
import type { LlmPort } from './providers/llm/port'
import { createCsvKeywordDriver } from './providers/keywords/csv-driver'
import type { KeywordSourcePort } from './providers/keywords/port'
import { createFilesystemPublishingDriver } from './providers/publishing/filesystem-driver'
import type { PublishingPort } from './providers/publishing/port'
import { createScheduler } from './scheduler'
import type { Scheduler } from './scheduler'
import type { JobHandlerRegistry } from './job-types'
import type { Hono } from 'hono'

export interface Runtime {
  env: Env
  db: ReturnType<typeof createDb>
  outbox: Outbox
  app: Hono
  llm: LlmPort
  keywordSource: KeywordSourcePort
  publishing: PublishingPort
  drainLoop: DrainLoop
  scheduler: Scheduler
  /** Drains the outbox once with the wired task handlers. */
  drainOutboxOnce(): Promise<number>
  /** Runs every registered periodic job once and returns. The cron entrypoint. */
  runJobsOnce(): Promise<void>
  close(): Promise<void>
}

export function createRuntime(env: Env): Runtime {
  const db = createDb(env.databaseUrl)
  const outbox = createOutbox(db)
  const app = createApp({
    probe: {
      ping: () => pingDatabase(db),
      migrationsApplied: () => migrationsApplied(db),
    },
    cors: {
      publicOrigins: env.corsPublicOrigins,
      appOrigins: env.corsAppOrigins,
    },
  })

  const rawLlm: LlmPort =
    env.llmProvider === 'deepseek'
      ? createDeepseekDriver({
          baseUrl: env.deepseekBaseUrl,
          model: env.deepseekModel,
          apiKey: env.deepseekApiKey,
          timeoutMs: env.llmTimeoutMs,
          maxOutputTokens: env.llmMaxOutputTokens,
          pricing: {
            inputPriceUsdPer1m: env.deepseekInputPriceUsdPer1m,
            outputPriceUsdPer1m: env.deepseekOutputPriceUsdPer1m,
            usdToRubRate: env.deepseekUsdToRubRate,
          },
        })
      : createFakeLlmDriver()

  // Guard → instrumentation → driver: personal data is refused before anything is
  // recorded (a PII payload leaves no llm_runs row at all), and every call that reaches
  // the driver leaves one.
  const llm = createGuardedLlmPort(
    createInstrumentedLlmPort(rawLlm, {
      db,
      provider: env.llmProvider === 'deepseek' ? 'deepseek' : 'fake',
      model: env.llmProvider === 'deepseek' ? env.deepseekModel : 'fake-deterministic',
      workspaceSlug: 'pipupi',
      monthlyCapMinorUnits: env.llmMonthlyCostCapMinorUnits,
    }),
  )

  const keywordSource = createCsvKeywordDriver({ maxRows: env.keywordsCsvMaxRows })
  const publishing = createFilesystemPublishingDriver({ rootDirectory: '.storage/public' })

  const auth = createAuthModule({
    db,
    jwtSecret: env.jwtSecret,
    settings: {
      accessTokenTtlSeconds: env.accessTokenTtlSeconds,
      refreshTokenTtlDays: env.refreshTokenTtlDays,
      sessionAbsoluteTtlDays: env.sessionAbsoluteTtlDays,
      rotationRaceWindowMs: 30_000,
    },
    cookie: {
      name: env.authCookieName,
      path: env.authCookiePath,
      sameSite: env.authCookieSameSite,
      secure: env.authCookieSecure,
    },
    refreshTokenTtlDays: env.refreshTokenTtlDays,
    rateLimit: {
      max: env.authRateLimitMax,
      windowMs: env.authRateLimitWindowSeconds * 1000,
      trustedProxyIpHeader: env.trustedProxyClientIpHeader,
    },
  })
  const authPick = { requireAuth: auth.requireAuth, requireRole: auth.requireRole }

  const users = createUsersModule({ db, auth: authPick })

  const content = createContentModule({ db, llm, outbox, auth: authPick })
  const publishingModule = createPublishingModule({ db, outbox, publishing, auth: authPick })

  const subjectHashProviders: SubjectHashProvider = {
    content_revision: content.revisionHash,
    service_request_plan: async (planId) => {
      const plan = await db.serviceRequestPlan.findUnique({ where: { id: planId } })
      return plan?.contentHash ?? null
    },
  }
  const approvals = createApprovalsModule({ db, hashProvider: subjectHashProviders, auth: authPick })
  const approvalsDeps = { db, hashProvider: subjectHashProviders }

  const serviceRequests = createServiceRequestsModule({ db, approvals: approvalsDeps, auth: authPick })
  const research = createResearchModule({ db, keywordSource, auth: authPick })

  const publicRateLimit = createRateLimiter({
    max: env.authRateLimitMax,
    windowMs: env.authRateLimitWindowSeconds * 1000,
    trustedProxyIpHeader: env.trustedProxyClientIpHeader,
  }).middleware
  const leads = createLeadsModule({ db, rateLimit: publicRateLimit, auth: authPick })
  const attribution = createAttributionModule({ db, rateLimit: publicRateLimit, auth: authPick })
  const analytics = createAnalyticsModule({ db, auth: authPick })
  const evidence = createEvidenceModule({ db, auth: authPick })
  const geo = createGeoModule({ db, auth: authPick })

  app.route('/api/auth', auth.routes)
  app.route('/api/users', users.routes)
  app.route('/api/service-requests', serviceRequests.routes)
  app.route('/api/approvals', approvals.routes)
  app.route('/api/research', research.routes)
  app.route('/api/content', content.routes)
  app.route('/api', publishingModule.routes)
  app.route('/api', leads.routes)
  app.route('/api/public', leads.publicRoutes)
  app.route('/api/attribution', attribution.routes)
  app.route('/api/public', attribution.publicRoutes)
  app.route('/api/analytics', analytics.routes)
  app.route('/api/evidence', evidence.routes)
  app.route('/api/geo', geo.routes)

  const taskHandlers: TaskHandlerRegistry = {
    ...content.taskHandlers,
    ...publishingModule.taskHandlers,
  }
  const drainDeps = { outbox, handlers: taskHandlers }

  const jobHandlers: JobHandlerRegistry = {
    'outbox.drain': async () => {
      await drainOnce(drainDeps)
    },
    'auth.sessions.cleanup': createSessionCleanup(db, env.sessionRetentionDays),
  }

  return {
    env,
    db,
    outbox,
    app,
    llm,
    keywordSource,
    publishing,
    drainLoop: createDrainLoop(drainDeps),
    scheduler: createScheduler({ jobs, handlers: jobHandlers }),
    drainOutboxOnce: () => drainOnce(drainDeps),
    runJobsOnce: async () => {
      for (const job of jobs) {
        await jobHandlers[job.name]()
      }
    },
    close: () => db.$disconnect(),
  }
}
