/**
 * Database access for the backend process.
 *
 * Prisma 7 requires a driver adapter: the client carries no connection URL, and the pool
 * lives here. `pg` and the Prisma runtime are backend-level infrastructure, not provider
 * SDKs — the AC-1 boundary (provider SDKs under backend/src/providers/**) does not apply
 * to the database layer, and the architecture check confirms that by design.
 *
 * Readiness is a separate concern from liveness: `/health/ready` must answer negatively
 * until migrations have been applied, and `migrationsApplied` is what allows that without
 * coupling the health routes to a specific table.
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.ts'

export type Db = PrismaClient

export interface CreateDbOptions {
  poolMax?: number
}

/**
 * The adapter owns the pool (it is given pool configuration, not a Pool instance), so
 * `db.$disconnect()` closes every connection — a caller must not need a second handle to
 * tear the process down cleanly.
 */
export function createDb(databaseUrl: string, options: CreateDbOptions = {}): Db {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: options.poolMax ?? 10 }),
  })
}

export async function pingDatabase(db: Db): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

/**
 * True when at least one migration has been applied. Prisma records applied migrations in
 * `_prisma_migrations`; before the first `prisma migrate deploy` the table does not exist
 * at all, which is exactly the state `/health/ready` must report as not ready — a `false`
 * answer, not an exception. `to_regclass` distinguishes the two without relying on error
 * codes.
 */
export async function migrationsApplied(db: Db): Promise<boolean> {
  const presence = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "exists"`
  if (!presence[0]?.exists) return false

  const counts = await db.$queryRaw<Array<{ applied: number }>>`
    SELECT count(*)::int AS "applied"
    FROM _prisma_migrations
    WHERE finished_at IS NOT NULL`
  return (counts[0]?.applied ?? 0) > 0
}
