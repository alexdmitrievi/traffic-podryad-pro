/**
 * The jobs registry (docs/ARCHITECTURE.md section 5).
 *
 * One declaration per job, and the declaration says WHAT runs, never WHERE or WHEN: the
 * cron entrypoint runs every job once, the scheduler runs the long-lived process loop,
 * and the worker drains the outbox. All three runners read this file.
 *
 * This file carries only type imports on purpose: tools must be able to read the registry
 * without a database and before `prisma generate`. A unit test asserts exactly that — any
 * value import here is a regression that pulls the runtime into the registry.
 */

import type { JobName } from './job-types'

export interface JobDefinition {
  name: JobName
  /** How often the scheduler considers the job due. */
  everyMinutes: number
}

export const jobs: readonly JobDefinition[] = [
  { name: 'outbox.drain', everyMinutes: 1 },
  { name: 'auth.sessions.cleanup', everyMinutes: 24 * 60 },
]
