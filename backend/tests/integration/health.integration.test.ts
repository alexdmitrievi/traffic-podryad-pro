import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from 'pg'
import { createApp } from '../../src/app'
import { createDb, migrationsApplied, pingDatabase } from '../../src/db'
import { createTestDb, testDatabaseUrl } from './helpers'
import type { Db } from '../../src/db'

/**
 * The test database has migrations applied by the `test:integration` script before these
 * run (prisma migrate deploy), so readiness is positive against it. The negative state is
 * proven twice: with fake probes in backend/src/app.test.ts, and here against a scratch
 * database that never saw a migration — the exact state /health/ready must refuse.
 */

let db: Db

const cors = {
  publicOrigins: ['http://localhost:4321'],
  appOrigins: ['http://localhost:5173'],
}

describe('health against a migrated database', () => {
  beforeAll(() => {
    db = createTestDb()
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  test('the database answers and migrations are applied', async () => {
    db = createTestDb()

    expect(await pingDatabase(db)).toBe(true)
    expect(await migrationsApplied(db)).toBe(true)
  })

  test('/health/ready is positive', async () => {
    const app = createApp({
      probe: {
        ping: () => pingDatabase(db),
        migrationsApplied: () => migrationsApplied(db),
      },
      cors,
    })

    const response = await app.request('/health/ready')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready' })
  })

  test(
    '/health/ready is negative on a database without migrations',
    async () => {
      const scratchName = 'pipupi_test_scratch'
      const baseUrl = testDatabaseUrl()
      const scratchUrl = baseUrl.replace(/\/[^/]+$/, `/${scratchName}`)

      const admin = new Client({ connectionString: baseUrl })
      await admin.connect()

      const scratchDb = createDb(scratchUrl)
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${scratchName}`)
        await admin.query(`CREATE DATABASE ${scratchName}`)

        expect(await pingDatabase(scratchDb)).toBe(true)
        expect(await migrationsApplied(scratchDb)).toBe(false)

        const app = createApp({
          probe: {
            ping: () => pingDatabase(scratchDb),
            migrationsApplied: () => migrationsApplied(scratchDb),
          },
          cors,
        })

        const response = await app.request('/health/ready')
        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({ status: 'not_ready', reason: 'migrations_pending' })
      } finally {
        await scratchDb.$disconnect()
        await admin.query(`DROP DATABASE IF EXISTS ${scratchName}`)
        await admin.end()
      }
    },
    // Two DROP/CREATE DATABASE round-trips plus pool teardown: generous budget on purpose.
    20_000,
  )
})
