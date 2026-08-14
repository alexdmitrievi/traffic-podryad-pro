/**
 * Cron entrypoint: runs every registered periodic job once and exits.
 *
 * The platform timer invokes this entrypoint on a schedule; the job registry decides WHAT
 * runs, never WHEN. In the MVP the only job is the one-shot outbox drain, which claims
 * rows until the queue is empty.
 */

import { describeEnvError, loadEnv } from '../env'
import { createRuntime } from '../runtime'

async function main(): Promise<void> {
  const env = loadEnv(process.env)
  const runtime = createRuntime(env)
  console.log(`[cron] running ${env.nodeEnv} jobs once`)

  try {
    await runtime.runJobsOnce()
  } finally {
    await runtime.close()
  }
  console.log('[cron] done')
  process.exit(0)
}

try {
  await main()
} catch (error) {
  console.error(`[cron] failed:\n${describeEnvError(error)}`)
  process.exit(1)
}
