import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { EnvValidationError, loadEnv } from './env'

const valid: Record<string, string | undefined> = {
  NODE_ENV: 'development',
  PORT: '8080',
  DATABASE_URL: 'postgresql://pipupi:pipupi_local_password@localhost:54329/pipupi',
  REQUIRE_HUMAN_APPROVAL: 'true',
  OUTBOUND_MESSAGING_ENABLED: 'false',
  PII_TO_LLM_ALLOWED: 'false',
  AUTH_COOKIE_SECURE: 'false',
}

describe('loadEnv', () => {
  test('a valid environment parses with defaults applied', () => {
    const env = loadEnv({ ...valid })

    expect(env.nodeEnv).toBe('development')
    expect(env.port).toBe(8080)
    expect(env.requireHumanApproval).toBe(true)
    expect(env.outboundMessagingEnabled).toBe(false)
    expect(env.piiToLlmAllowed).toBe(false)
    expect(env.authCookieSecure).toBe(false)
  })

  test('PORT and NODE_ENV have local defaults', () => {
    const { PORT: _port, NODE_ENV: _nodeEnv, ...rest } = valid
    const env = loadEnv({ ...rest })

    expect(env.port).toBe(8080)
    expect(env.nodeEnv).toBe('development')
  })

  test('each compliance fuse refuses any value other than its MVP one', () => {
    for (const [key, badValue] of [
      ['REQUIRE_HUMAN_APPROVAL', 'false'],
      ['OUTBOUND_MESSAGING_ENABLED', 'true'],
      ['PII_TO_LLM_ALLOWED', 'true'],
    ] as const) {
      expect(() => loadEnv({ ...valid, [key]: badValue })).toThrow(EnvValidationError)
      expect(() => loadEnv({ ...valid, [key]: badValue })).toThrow(key)
    }
  })

  test('a missing fuse is a refusal, not a default', () => {
    for (const key of ['REQUIRE_HUMAN_APPROVAL', 'OUTBOUND_MESSAGING_ENABLED', 'PII_TO_LLM_ALLOWED']) {
      const { [key]: _removed, ...rest } = valid
      expect(() => loadEnv({ ...rest })).toThrow(key)
    }
  })

  test('a non-boolean fuse value is a refusal', () => {
    expect(() => loadEnv({ ...valid, REQUIRE_HUMAN_APPROVAL: 'yes' })).toThrow('REQUIRE_HUMAN_APPROVAL')
  })

  test('AUTH_COOKIE_SECURE=false is refused in production and allowed locally', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production' })).toThrow('AUTH_COOKIE_SECURE')
    expect(loadEnv({ ...valid, NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'true' }).authCookieSecure).toBe(true)
    expect(loadEnv({ ...valid }).authCookieSecure).toBe(false)
  })

  test('DATABASE_URL is required and must be a postgres URL', () => {
    const { DATABASE_URL: _removed, ...rest } = valid
    expect(() => loadEnv({ ...rest })).toThrow('DATABASE_URL')

    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow('DATABASE_URL')
    expect(() => loadEnv({ ...valid, DATABASE_URL: '' })).toThrow('DATABASE_URL')
  })

  test('PORT must be a valid integer', () => {
    expect(() => loadEnv({ ...valid, PORT: 'not-a-number' })).toThrow('PORT')
    expect(() => loadEnv({ ...valid, PORT: '70000' })).toThrow('PORT')
    expect(loadEnv({ ...valid, PORT: '8081' }).port).toBe(8081)
  })
})

describe('the process refuses to boot with a non-zero exit code', () => {
  const entrypoint = path.join(import.meta.dir, 'entrypoints/api.ts')
  // Spawning a fresh bun process is slow on Windows (startup plus antivirus scanning);
  // the budget is generous on purpose — the point is the exit code, not the speed.
  const spawnTimeout = 20_000

  async function spawnApi(overrides: Record<string, string | undefined>) {
    const proc = Bun.spawn({
      cmd: [process.execPath, entrypoint],
      cwd: path.join(import.meta.dir, '..'),
      env: { ...valid, ...overrides },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ])

    return { exitCode, stderr }
  }

  test('REQUIRE_HUMAN_APPROVAL=false', async () => {
    const { exitCode, stderr } = await spawnApi({ REQUIRE_HUMAN_APPROVAL: 'false' })
    expect(exitCode).toBe(1)
    expect(stderr).toContain('REQUIRE_HUMAN_APPROVAL')
  }, spawnTimeout)

  test('OUTBOUND_MESSAGING_ENABLED=true', async () => {
    const { exitCode, stderr } = await spawnApi({ OUTBOUND_MESSAGING_ENABLED: 'true' })
    expect(exitCode).toBe(1)
    expect(stderr).toContain('OUTBOUND_MESSAGING_ENABLED')
  }, spawnTimeout)

  test('PII_TO_LLM_ALLOWED=true', async () => {
    const { exitCode, stderr } = await spawnApi({ PII_TO_LLM_ALLOWED: 'true' })
    expect(exitCode).toBe(1)
    expect(stderr).toContain('PII_TO_LLM_ALLOWED')
  }, spawnTimeout)

  test('AUTH_COOKIE_SECURE=false in production', async () => {
    const { exitCode, stderr } = await spawnApi({
      NODE_ENV: 'production',
      AUTH_COOKIE_SECURE: 'false',
    })
    expect(exitCode).toBe(1)
    expect(stderr).toContain('AUTH_COOKIE_SECURE')
  }, spawnTimeout)

  test('missing DATABASE_URL', async () => {
    // An empty value, not `undefined`: bun loads backend/.env into every child process
    // started from this directory, and an env key absent from the spawn environment would
    // be silently filled from that file — turning this refusal test into a boot test.
    const { exitCode, stderr } = await spawnApi({ DATABASE_URL: '' })
    expect(exitCode).toBe(1)
    expect(stderr).toContain('DATABASE_URL')
  }, spawnTimeout)
})
