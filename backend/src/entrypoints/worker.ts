/**
 * Worker entrypoint: the outbox drain loop as a long-lived process.
 *
 * Graceful shutdown drains the accepted work: `drainLoop.stop()` resolves only after the
 * task claimed before the stop request has been handled to completion. The deadline is a
 * hard backstop — a hang beyond it exits non-zero rather than pretending a clean stop.
 */

import { describeEnvError, loadEnv } from '../env'
import { createRuntime } from '../runtime'

const SHUTDOWN_GRACE_MS = 30_000

async function main(): Promise<void> {
  const env = loadEnv(process.env)
  const runtime = createRuntime(env)
  console.log(`[worker] draining outbox (${env.nodeEnv})`)

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[worker] ${signal} received; draining accepted task`)

    const deadline = setTimeout(() => {
      console.error('[worker] graceful shutdown deadline exceeded; forcing exit')
      process.exit(1)
    }, SHUTDOWN_GRACE_MS)

    try {
      await runtime.drainLoop.stop()
      await runtime.close()
      clearTimeout(deadline)
      console.log('[worker] shutdown complete')
      process.exit(0)
    } catch (error) {
      clearTimeout(deadline)
      console.error('[worker] shutdown failed:', describeEnvError(error))
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await runtime.drainLoop.start()
}

try {
  await main()
} catch (error) {
  console.error(`[worker] refusing to start:\n${describeEnvError(error)}`)
  process.exit(1)
}
