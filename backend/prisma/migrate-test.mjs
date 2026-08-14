/**
 * Applies migrations to the test database.
 *
 * The env-prefix syntax (`DATABASE_URL=$TEST_DATABASE_URL prisma migrate deploy`) is not
 * reliable across shells, so the URL is switched explicitly here. The test database is the
 * dedicated Docker service on a separate port (docs/LOCAL_DATABASE.md) — migrations must
 * never run against the development database from this script.
 */

import { $ } from 'bun'

const url = process.env.TEST_DATABASE_URL
if (!url) {
  throw new Error('TEST_DATABASE_URL is required to migrate the test database')
}

await $`prisma migrate deploy`.env({ ...process.env, DATABASE_URL: url })
