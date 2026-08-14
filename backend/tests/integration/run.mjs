/**
 * Runs the integration suite file by file, sequentially.
 *
 * Integration tests share one database, and the outbox drain tests start real claim loops.
 * Parallel file execution lets a loop from one file claim rows enqueued by another, which
 * turns every assertion timing-dependent. Serial execution is the honest fix: the tests
 * themselves exercise concurrency where it matters (two drains, two workers), the runner
 * just must not add a third, accidental one.
 */

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'

const directory = path.dirname(fileURLToPath(import.meta.url))
const files = (await readdir(directory))
  .filter((name) => name.endsWith('.integration.test.ts'))
  .sort()

if (files.length === 0) {
  throw new Error(`No integration test files found in ${directory}`)
}

for (const file of files) {
  console.log(`\n[integration] ${file}`)
  await $`bun test ${path.join(directory, file)}`
}

console.log(`\n[integration] ${files.length} file(s) passed`)
