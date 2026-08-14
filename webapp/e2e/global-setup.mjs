/**
 * E2E global setup: apply migrations and reset the database to a known state, so the
 * scenario starts clean and can be re-run. Playwright runs this file under Node, so it
 * uses plain child_process and absolute paths.
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
// The local default matches docker-compose and docs/LOCAL_DATABASE.md; CI passes the
// service address explicitly.
const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pipupi:pipupi_local_password@localhost:54330/pipupi_test'

const env = { ...process.env, TEST_DATABASE_URL: url }

export default async function globalSetup() {
  execFileSync('bun', ['run', '--cwd', 'backend', 'prisma:migrate:deploy:test'], {
    cwd: root,
    env,
    stdio: 'inherit',
  })
  execFileSync('bun', ['webapp/e2e/reset-db.mjs'], { cwd: root, env, stdio: 'inherit' })

  console.log('[e2e] setup complete')
}
