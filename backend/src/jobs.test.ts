import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'

/**
 * The registry must stay readable without a database and before `prisma generate` — that is
 * the point of the "type imports only" rule (docs/WAVE_4_DELEGATION.md section 4a). A value
 * import here would pull the runtime into the registry and this test would fail.
 */
describe('jobs registry', () => {
  test('jobs.ts carries only type imports', async () => {
    const source = await readFile(path.join(import.meta.dir, 'jobs.ts'), 'utf8')

    expect(source).toContain('import type')
    expect(source).not.toMatch(/^\s*import\s+(?!type)/m)
    expect(source).not.toMatch(/\brequire\s*\(/)
  })

  test('importing the registry needs no database and no generated client', async () => {
    const { jobs } = await import('./jobs')

    expect(jobs.map((job) => job.name)).toEqual(['outbox.drain', 'auth.sessions.cleanup'])
    expect(jobs[0]?.everyMinutes).toBe(1)
    expect(jobs[1]?.everyMinutes).toBe(24 * 60)
  })
})
