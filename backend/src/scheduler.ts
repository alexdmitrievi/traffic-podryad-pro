/**
 * The scheduler runner: a long-lived loop that runs each registered job when it is due.
 *
 * Dependencies (sleep and now) are injectable so the due logic is unit-testable without
 * real timers. Handlers run sequentially per tick; a failing handler is logged and does
 * not stop the loop — the next tick simply retries it as still due.
 */

import type { JobDefinition } from './jobs'
import type { JobHandlerRegistry } from './job-types'
import type { Logger } from './outbox/drain-loop'
import { silentLogger } from './outbox/drain-loop'

export function isDue(lastRunMs: number | null, everyMinutes: number, nowMs: number): boolean {
  return lastRunMs === null || nowMs - lastRunMs >= everyMinutes * 60_000
}

export interface SchedulerDeps {
  jobs: readonly JobDefinition[]
  handlers: Partial<JobHandlerRegistry>
  logger?: Logger
  tickMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export interface Scheduler {
  start(): Promise<void>
  stop(): Promise<void>
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const logger = deps.logger ?? silentLogger
  const tickMs = deps.tickMs ?? 5_000
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = deps.now ?? Date.now
  let running = false
  let loop: Promise<void> | null = null

  const run = async (): Promise<void> => {
    const lastRun = new Map<string, number>()
    while (running) {
      const nowMs = now()
      for (const job of deps.jobs) {
        if (!isDue(lastRun.get(job.name) ?? null, job.everyMinutes, nowMs)) continue
        const handler = deps.handlers[job.name]
        if (!handler) {
          logger.error(`[scheduler] job ${job.name} has no registered handler; skipping`)
          continue
        }
        try {
          await handler()
          // The window restarts only after a successful run: a failing job stays due and
          // is retried on the next tick rather than silently skipping its window.
          lastRun.set(job.name, nowMs)
        } catch (error) {
          logger.error(`[scheduler] job ${job.name} failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      await sleep(tickMs)
    }
  }

  return {
    start() {
      running = true
      loop = run()
      return loop
    },
    async stop() {
      running = false
      if (loop) await loop
    },
  }
}
