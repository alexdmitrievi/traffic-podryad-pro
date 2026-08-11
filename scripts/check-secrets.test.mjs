/**
 * Tests for the secret scanner. secret-scan:fixtures
 *
 * This file carries the fixture marker because its job is to contain credential-shaped
 * strings. They are assembled at runtime from fragments and none of them is real.
 *
 * Same tamper-evidence shape as the architecture checker: planted secrets must be found,
 * and legitimate placeholders must not be. A scanner that finds nothing and a scanner that
 * is broken look identical in CI, so both directions are asserted.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import {
  FIXTURE_MARKER,
  credentialPatterns,
  hasFixtureMarker,
  isPlaceholder,
  scanFiles,
} from './check-secrets.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))

/**
 * Planted, obviously fake values built at runtime from fragments, so this test file never
 * contains a literal that looks like a credential to any other tool.
 */
const planted = {
  openai: ['sk', 'A'.repeat(24)].join('-'),
  github: ['ghp', 'b'.repeat(36)].join('_'),
  aws: `AKIA${'C'.repeat(16)}`,
  slack: ['xoxb', '123456789012', 'D'.repeat(24)].join('-'),
  google: `AIza${'E'.repeat(35)}`,
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'F'.repeat(20)].join('.'),
  telegram: ['1234567890', `AA${'G'.repeat(32)}`].join(':'),
  privateKey: `${'-'.repeat(5)}BEGIN RSA PRIVATE KEY${'-'.repeat(5)}`,
}

describe('planted credentials are found', () => {
  for (const [name, value] of Object.entries(planted)) {
    test(`detects a ${name} credential`, () => {
      const findings = scanFiles([{ path: 'somewhere/config.txt', source: `value = ${value}\n` }])
      expect(findings.length).toBeGreaterThan(0)
    })
  }

  test('reports the correct path and line', () => {
    const findings = scanFiles([
      { path: 'backend/config.ts', source: `const a = 1\nconst b = 2\nconst key = '${planted.aws}'\n` },
    ])

    expect(findings[0].path).toBe('backend/config.ts')
    expect(findings[0].line).toBe(3)
  })

  test('detects a concrete value assigned to a credential-shaped name', () => {
    const findings = scanFiles([
      { path: '.env', source: 'DEEPSEEK_API_KEY=9f4c1b7e2a8d6035ff21c9\n' },
    ])

    expect(findings.some((finding) => finding.rule === 'assigned-credential')).toBe(true)
  })

  test('detects a remote connection string with an inline password', () => {
    const findings = scanFiles([
      {
        path: 'docs/notes.md',
        source: 'postgresql://appuser:s3rV1ceR0leK3y@db.production.example.net:5432/app\n',
      },
    ])

    expect(findings.some((finding) => finding.rule === 'connection-string-credential')).toBe(true)
  })
})

describe('legitimate content is not flagged', () => {
  const allowed = [
    { name: 'empty credential value', source: 'DEEPSEEK_API_KEY=\nLLM_TIMEOUT_MS=120000\n' },
    { name: 'marked placeholder', source: 'JWT_SECRET=REPLACE_ME\n' },
    { name: 'angle-bracket placeholder', source: 'API_KEY=<your-key-here>\n' },
    { name: 'shell interpolation', source: 'API_TOKEN=${DEEPSEEK_API_KEY}\n' },
    { name: 'local database password', source: 'POSTGRES_PASSWORD=pipupi_local_password\n' },
    { name: 'local connection string', source: 'DATABASE_URL=postgresql://pipupi:pipupi_local_password@localhost:54329/pipupi\n' },
    { name: 'compose service host', source: 'DATABASE_URL=postgresql://pipupi:pipupi_local_password@postgres:5432/pipupi\n' },
    { name: 'boolean compliance guard', source: 'REQUIRE_HUMAN_APPROVAL=true\nOUTBOUND_MESSAGING_ENABLED=false\n' },
    { name: 'prose mentioning secrets', source: 'Секреты живут только в секрет-хранилище площадки.\n' },
    { name: 'allowed aws storage client', source: `import { S3Client } from '@aws-sdk/client-s3'\n` },
  ]

  for (const item of allowed) {
    test(`does not flag: ${item.name}`, () => {
      expect(scanFiles([{ path: 'backend/.env.example', source: item.source }])).toEqual([])
    })
  }

  test('an empty repository produces no findings', () => {
    expect(scanFiles([])).toEqual([])
  })
})

describe('placeholder classification', () => {
  test('recognises placeholder shapes', () => {
    for (const value of ['', '   ', 'REPLACE_ME', 'REPLACE_WITH_KEY', 'your-token', '<key>', '${KEY}', 'changeme', 'placeholder', 'example', 'xxxxxx', 'not-a-real-key']) {
      expect(isPlaceholder(value)).toBe(true)
    }
  })

  test('does not treat a concrete value as a placeholder', () => {
    for (const value of ['9f4c1b7e2a8d6035ff21c9', planted.aws, 's3rV1ceR0leK3y']) {
      expect(isPlaceholder(value)).toBe(false)
    }
  })
})

describe('scanner integrity', () => {
  test('the pattern set is not empty', () => {
    expect(credentialPatterns.length).toBeGreaterThanOrEqual(9)
  })

  /**
   * The scanner must not report its own detection patterns. If this breaks, the patterns
   * have started matching their own source and the scanner would flag every repository
   * that contains it — which in practice means someone disables it.
   *
   * Note this file is NOT part of the assertion: it carries the fixture marker and is
   * expected to contain credential-shaped strings. The scanner source carries no marker
   * and must stand on its own.
   */
  test('the scanner source scans clean without needing an exemption', async () => {
    const source = await readFile(path.join(scriptsDirectory, 'check-secrets.mjs'), 'utf8')

    expect(hasFixtureMarker(source)).toBe(false)
    expect(scanFiles([{ path: 'scripts/check-secrets.mjs', source }])).toEqual([])
  })
})

describe('fixture exemption', () => {
  const source = `const key = '${planted.aws}'\n`

  test('an unmarked file with a planted credential is reported', () => {
    expect(scanFiles([{ path: 'scripts/whatever.mjs', source }]).length).toBeGreaterThan(0)
  })

  test('the same content is skipped when the file carries the marker', () => {
    const marked = `// ${FIXTURE_MARKER}\n${source}`

    expect(hasFixtureMarker(marked)).toBe(true)
    expect(scanFiles([{ path: 'scripts/whatever.test.mjs', source: marked }])).toEqual([])
  })

  test('the marker is only honoured near the top of the file', () => {
    const buried = `${'\n'.repeat(60)}// ${FIXTURE_MARKER}\n${source}`

    expect(hasFixtureMarker(buried)).toBe(false)
    expect(scanFiles([{ path: 'scripts/buried.mjs', source: buried }]).length).toBeGreaterThan(0)
  })

  test('this test file is the only exemption the repository expects', async () => {
    // scripts/repo-env.mjs enforces the same allowlist across the whole tree; this asserts
    // the marker is genuinely present here, so the two checks cannot drift apart silently.
    const own = await readFile(path.join(scriptsDirectory, 'check-secrets.test.mjs'), 'utf8')
    expect(hasFixtureMarker(own)).toBe(true)
  })
})
