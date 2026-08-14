import { describe, expect, test } from 'bun:test'
import { loadEnv } from './env'
import { createRuntime } from './runtime'

/**
 * The GET allowlist: a state-changing endpoint must never answer on GET, because the
 * session cookie accompanies top-level navigations (SameSite=Lax lets safe methods
 * through) — docs/DOMAINS.md section 4.1. This test walks the mounted route table of the
 * fully wired application and pins every GET path to the read-only allowlist, so a new
 * GET handler on a mutating path fails the build.
 */

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused:unused@localhost:1/unused',
  REQUIRE_HUMAN_APPROVAL: 'true',
  OUTBOUND_MESSAGING_ENABLED: 'false',
  PII_TO_LLM_ALLOWED: 'false',
  AUTH_COOKIE_SECURE: 'false',
  JWT_SECRET: 'local_test_jwt_secret_0123456789',
  AUTH_COOKIE_PATH: '/',
  CORS_PUBLIC_ORIGINS: 'http://localhost:4321',
  CORS_APP_ORIGINS: 'http://localhost:5173',
})

const runtime = createRuntime(env)

/** Hono's route table repeats a path once per handler in its middleware chain; the test
 *  cares about the set of (method, path) pairs, so duplicates are collapsed. */
function routePairs(app: typeof runtime.app): Array<{ method: string; path: string }> {
  const seen = new Set<string>()
  const pairs: Array<{ method: string; path: string }> = []
  for (const route of app.routes) {
    const key = `${route.method} ${route.path}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push({ method: route.method, path: route.path })
  }
  return pairs
}

describe('the wired application route table', () => {
  test('every GET route is read-only', () => {
    const readOnlyAllowlist = new Set([
      '/health',
      '/health/live',
      '/health/ready',
      '/api/users',
      '/api/users/me',
      '/api/service-requests',
      '/api/service-requests/:id',
      '/api/approvals/state',
      '/api/research/keywords',
      '/api/research/clusters',
      '/api/content/briefs',
      '/api/content/items',
      '/api/content/items/:id',
      '/api/publications',
      '/api/leads',
      '/api/attribution/leads/:id/attribution',
      '/api/analytics/funnel',
      '/api/evidence/sources',
      '/api/evidence/claims',
    ])

    const getPaths = routePairs(runtime.app)
      .filter((route) => route.method === 'GET')
      .map((route) => route.path)

    expect(getPaths.length).toBeGreaterThan(0)
    for (const path of getPaths) {
      expect(readOnlyAllowlist).toContain(path)
    }
  })

  test('the auth and users endpoints exist on mutating methods only', () => {
    const pairs = routePairs(runtime.app)
    const byMethod = (method: string) =>
      pairs.filter((route) => route.method === method).map((route) => route.path)

    expect(byMethod('POST')).toEqual(
      expect.arrayContaining(['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/users']),
    )
    expect(byMethod('PATCH')).toContain('/api/users/:id/role')

    // The complementary half of the GET rule: no mutating endpoint answers on GET.
    const mutatingOnlyPaths = [
      '/api/auth/login',
      '/api/auth/refresh',
      '/api/auth/logout',
      '/api/users/:id/role',
    ]
    for (const path of mutatingOnlyPaths) {
      expect(byMethod('GET')).not.toContain(path)
    }
  })
})
