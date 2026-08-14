/**
 * API entrypoint: environment validation, HTTP server, graceful shutdown.
 *
 * The process refuses to boot — non-zero exit code — when the compliance fuses disagree
 * with the MVP phase or when AUTH_COOKIE_SECURE=false in production. That refusal happens
 * before any database connection is opened.
 */

import { describeEnvError, loadEnv } from '../env'
import { createRuntime } from '../runtime'
import { waitForBackgroundTasks } from '../background-tasks'

const SHUTDOWN_GRACE_MS = 10_000

async function main(): Promise<void> {
  const env = loadEnv(process.env)
  const runtime = createRuntime(env)

  const server = Bun.serve({
    port: env.port,
    hostname: '0.0.0.0',
    fetch: runtime.app.fetch,
  })
  console.log(`[api] listening on :${env.port} (${env.nodeEnv})`)

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[api] ${signal} received; draining accepted requests`)

    const deadline = setTimeout(() => {
      console.error('[api] graceful shutdown deadline exceeded; forcing exit')
      process.exit(1)
    }, SHUTDOWN_GRACE_MS)

    try {
      await server.stop()
      await waitForBackgroundTasks(SHUTDOWN_GRACE_MS)
      await runtime.close()
      clearTimeout(deadline)
      console.log('[api] shutdown complete')
      process.exit(0)
    } catch (error) {
      clearTimeout(deadline)
      console.error('[api] shutdown failed:', describeEnvError(error))
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

try {
  await main()
} catch (error) {
  console.error(`[api] refusing to start:\n${describeEnvError(error)}`)
  process.exit(1)
}
