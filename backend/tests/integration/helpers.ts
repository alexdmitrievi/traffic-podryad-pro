/**
 * Integration tests run against the Docker test database (docs/TESTING.md section 1).
 * They are kept out of `backend/src` so `bun test src` stays runnable without Docker.
 */

import type { Db } from '../../src/db'
import { createDb } from '../../src/db'

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is required for integration tests; start the test database with "bun run db:start:test" first',
    )
  }
  return url
}

export function createTestDb(): Db {
  return createDb(testDatabaseUrl(), { poolMax: 5 })
}

export async function clearOutbox(db: Db): Promise<void> {
  await db.$executeRawUnsafe('DELETE FROM task_outbox')
}

/**
 * Wipes every product row in FK-safe order, then all users and sessions. Used by suites
 * that create product data so a later suite can delete its own users without tripping
 * RESTRICT foreign keys.
 */
export async function wipeDatabase(db: Db): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.attributionTouch.deleteMany()
    await tx.lead.deleteMany()
    await tx.publication.deleteMany()
    await tx.approval.deleteMany()
    await tx.contentRevision.deleteMany()
    await tx.contentItem.deleteMany()
    await tx.contentBrief.deleteMany()
    await tx.clusterKeyword.deleteMany()
    await tx.topicCluster.deleteMany()
    await tx.keywordMetric.deleteMany()
    await tx.keyword.deleteMany()
    await tx.serviceRequestPlan.deleteMany()
    await tx.serviceRequestEvent.deleteMany()
    await tx.serviceRequest.deleteMany()
    await tx.llmRun.deleteMany()
    await tx.citation.deleteMany()
    await tx.claim.deleteMany()
    await tx.evidenceSource.deleteMany()
    await tx.geoVisibilitySnapshot.deleteMany()
    await tx.geoQuery.deleteMany()
    await tx.taskOutbox.deleteMany()
    await tx.authSession.deleteMany()
    await tx.user.deleteMany()
  })
}
