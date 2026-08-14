/**
 * The composition root: wires environment, database, outbox, health app and the background
 * runners into one runtime object that every entrypoint shares (docs/ARCHITECTURE.md
 * section 1 — one code base, one image, several entry points).
 *
 * The task handler registry is empty in unit 4a on purpose: no product task exists yet.
 * Brief generation, draft generation and publication arrive in units 4c/4d and register
 * themselves here. The worker is still real — a claimed task with no handler fails with
 * a visible error and eventually goes dead, never silently dropped.
 */

import { createApp } from './app'
import { createDb, migrationsApplied, pingDatabase } from './db'
import type { Env } from './env'
import { jobs } from './jobs'
import { createDrainLoop, drainOnce } from './outbox/drain-loop'
import type { DrainLoop, TaskHandlerRegistry } from './outbox/drain-loop'
import { createOutbox } from './outbox/outbox-service'
import type { Outbox } from './outbox/outbox-service'
import { createScheduler } from './scheduler'
import type { Scheduler } from './scheduler'
import type { JobHandlerRegistry } from './job-types'
import type { Hono } from 'hono'

export interface Runtime {
  env: Env
  db: ReturnType<typeof createDb>
  outbox: Outbox
  app: Hono
  drainLoop: DrainLoop
  scheduler: Scheduler
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
  })

  const taskHandlers: TaskHandlerRegistry = {}
  const drainDeps = { outbox, handlers: taskHandlers }

  const jobHandlers: JobHandlerRegistry = {
    'outbox.drain': async () => {
      await drainOnce(drainDeps)
    },
  }

  return {
    env,
    db,
    outbox,
    app,
    drainLoop: createDrainLoop(drainDeps),
    scheduler: createScheduler({ jobs, handlers: jobHandlers }),
    runJobsOnce: async () => {
      for (const job of jobs) {
        await jobHandlers[job.name]()
      }
    },
    close: () => db.$disconnect(),
  }
}
