/**
 * Outbox execution: the drain loop used by the worker entrypoint and the one-shot drain
 * used by the cron runner (docs/ARCHITECTURE.md section 5 — three interchangeable runners).
 *
 * Task types are an open set validated against a handler registry. A claimed task with no
 * handler fails; the retry policy of the outbox then drives it to `dead`, and the error is
 * visible on the row rather than lost in a log line.
 *
 * The loop is the worker's graceful-shutdown boundary: `stop()` resolves only after the
 * task claimed before the stop request has been handled to completion — the accepted work
 * is drained, and nothing new is claimed afterwards.
 */

import type { ClaimedTask, Outbox } from './outbox-service'

export type TaskHandler = (payload: unknown) => Promise<void>
export type TaskHandlerRegistry = Record<string, TaskHandler>

export interface Logger {
  info(message: string): void
  error(message: string): void
}

export const silentLogger: Logger = {
  info() {},
  error() {},
}

export interface DrainDeps {
  outbox: Outbox
  handlers: TaskHandlerRegistry
  logger?: Logger
  /** How long to sleep after an empty claim. */
  pollIntervalMs?: number
}

async function handleClaimed(deps: DrainDeps, task: ClaimedTask): Promise<void> {
  const logger = deps.logger ?? silentLogger
  const handler = deps.handlers[task.taskType]
  if (!handler) {
    logger.error(`[outbox] no handler for task type "${task.taskType}" (${task.id})`)
    await deps.outbox.fail({
      id: task.id,
      fencingToken: task.fencingToken,
      error: `no handler registered for task type "${task.taskType}"`,
    })
    return
  }

  try {
    await handler(task.payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`[outbox] task ${task.id} (${task.taskType}) failed: ${message}`)
    await deps.outbox.fail({ id: task.id, fencingToken: task.fencingToken, error: message })
    return
  }

  const completed = await deps.outbox.complete({ id: task.id, fencingToken: task.fencingToken })
  if (!completed) {
    logger.error(`[outbox] task ${task.id} lease lost; completion ignored`)
  }
}

export async function drainOnce(deps: DrainDeps): Promise<number> {
  const logger = deps.logger ?? silentLogger
  let handled = 0
  for (;;) {
    const claimed = await deps.outbox.claimNext()
    if (!claimed) break
    handled += 1
    logger.info(`[outbox] handling task ${claimed.id} (${claimed.taskType})`)
    await handleClaimed(deps, claimed)
  }
  return handled
}

export interface DrainLoop {
  start(): Promise<void>
  stop(): Promise<void>
}

export function createDrainLoop(deps: DrainDeps): DrainLoop {
  const pollIntervalMs = deps.pollIntervalMs ?? 1_000
  const logger = deps.logger ?? silentLogger
  let running = false
  let loop: Promise<void> | null = null

  const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs))

  const run = async (): Promise<void> => {
    while (running) {
      const claimed = await deps.outbox.claimNext()
      if (!claimed) {
        await sleep()
        continue
      }
      logger.info(`[outbox] claiming task ${claimed.id} (${claimed.taskType})`)
      await handleClaimed(deps, claimed)
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
