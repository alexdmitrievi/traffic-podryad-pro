/**
 * Starts the API server and the outbox drain in one process for the E2E run — the same
 * codebase and the same runtime object the separate entrypoints compose in production.
 * The webServer check waits on the API health URL; the drain loop runs alongside.
 */

import { loadEnv } from '../../backend/src/env.ts'
import { createRuntime } from '../../backend/src/runtime.ts'

const env = loadEnv(process.env)
const runtime = createRuntime(env)

Bun.serve({ port: env.port, hostname: '127.0.0.1', fetch: runtime.app.fetch })
console.log(`[e2e-backend] api on :${env.port}, worker draining`)

void runtime.drainLoop.start()

const shutdown = async () => {
  await runtime.drainLoop.stop()
  await runtime.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
