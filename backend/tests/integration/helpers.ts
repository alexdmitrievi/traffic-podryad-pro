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
