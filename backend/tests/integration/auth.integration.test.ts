import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { loadEnv } from '../../src/env'
import { createPasswordService } from '../../src/modules/auth'
import { createRuntime } from '../../src/runtime'
import type { Runtime } from '../../src/runtime'
import { createTestDb, testDatabaseUrl } from './helpers'
import type { Db } from '../../src/db'

/**
 * secret-scan:fixtures
 * The auth suite works with fake credentials by design — login, rotation and compromise
 * flows cannot be exercised without presenting passwords. Everything below is a test
 * fixture for a local test database and grants nothing anywhere. The exemption is pinned
 * in scripts/repo-env.mjs, so it cannot be extended without a second, deliberate change.
 *
 * The auth surface against a real database: login, rotation with the race-window rule,
 * compromise revocation, logout, role resolution from the database (immediate demotion),
 * the zero-admins invariant, origin enforcement and rate limiting.
 */

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: testDatabaseUrl(),
  REQUIRE_HUMAN_APPROVAL: 'true',
  OUTBOUND_MESSAGING_ENABLED: 'false',
  PII_TO_LLM_ALLOWED: 'false',
  AUTH_COOKIE_SECURE: 'false',
  JWT_SECRET: 'test-secret-that-is-long-enough-0123456789',
  AUTH_COOKIE_PATH: '/',
  CORS_PUBLIC_ORIGINS: 'https://pipupi.ru',
  CORS_APP_ORIGINS: 'https://app.pipupi.ru',
  // The functional flow tests share one limiter; the dedicated rate-limit test below spins
  // up its own runtime with a small window so the suites do not interfere.
  AUTH_RATE_LIMIT_MAX: '1000',
  AUTH_RATE_LIMIT_WINDOW_SECONDS: '60',
})

const admin = { email: 'admin@pipupi.ru', password: 'admin-password-123' }
const editor = { email: 'editor@pipupi.ru', password: 'editor-password-123' }

interface ErrorBody {
  error: { code: string; message: string }
}

interface AuthBody {
  user: { id: string; email: string; role: string }
  accessToken: string
}

interface MeBody {
  user: { id: string; email: string; role: string }
}

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

async function errorCode(response: Response): Promise<string> {
  return (await bodyOf<ErrorBody>(response)).error.code
}

let db: Db
let runtime: Runtime

function cookieFrom(response: Response): string | null {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) return null
  return setCookie.split(';')[0] ?? null
}

async function login(email: string, password: string): Promise<Response> {
  return runtime.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

describe('auth', () => {
  beforeAll(async () => {
    db = createTestDb()
    runtime = createRuntime(env)

    const passwords = createPasswordService()
    await db.user.create({
      data: {
        email: admin.email,
        passwordHash: await passwords.hash(admin.password),
        role: 'admin',
      },
    })
  })

  beforeEach(async () => {
    await db.authSession.deleteMany()
    await db.user.deleteMany({ where: { email: { not: admin.email } } })
  })

  afterAll(async () => {
    await db.authSession.deleteMany()
    await db.user.deleteMany()
    await runtime.close()
    await db.$disconnect()
  })

  test('login sets the session cookie with exactly the mandated attributes', async () => {
    const response = await login(admin.email, admin.password)

    expect(response.status).toBe(200)
    const body = await bodyOf<AuthBody>(response)
    expect(body.user.email).toBe(admin.email)
    expect(body.accessToken).toBeTruthy()
    expect('refreshToken' in body).toBe(false)

    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toContain('pip_rt=')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).not.toMatch(/Domain/i)
  })

  test('wrong password and unknown email get the same 401 — no account enumeration', async () => {
    const wrongPassword = await login(admin.email, 'definitely-wrong-password')
    const unknownEmail = await login('nobody@pipupi.ru', 'whatever-password')

    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(await errorCode(wrongPassword)).toBe('AUTH_INVALID_CREDENTIALS')
    expect(await errorCode(unknownEmail)).toBe('AUTH_INVALID_CREDENTIALS')
    expect(wrongPassword.headers.get('set-cookie')).toBeNull()
  })

  test('refresh rotates the credential', async () => {
    const loginResponse = await login(admin.email, admin.password)
    const firstCookie = cookieFrom(loginResponse)

    const refresh = await runtime.app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: firstCookie ?? '' },
    })

    expect(refresh.status).toBe(200)
    expect((await bodyOf<{ accessToken: string }>(refresh)).accessToken).toBeTruthy()

    const secondCookie = cookieFrom(refresh)
    expect(secondCookie).not.toBeNull()
    expect(secondCookie).not.toBe(firstCookie)
  })

  test('a replayed credential inside the race window succeeds idempotently without a new cookie', async () => {
    const loginResponse = await login(admin.email, admin.password)
    const firstCookie = cookieFrom(loginResponse)!

    await runtime.app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: firstCookie },
    })

    const replay = await runtime.app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: firstCookie },
    })

    expect(replay.status).toBe(200)
    expect(replay.headers.get('set-cookie')).toBeNull()
  })

  test('a replayed credential outside the race window revokes the session', async () => {
    const loginResponse = await login(admin.email, admin.password)
    const firstCookie = cookieFrom(loginResponse)!

    const rotated = await runtime.app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: firstCookie },
    })
    const secondCookie = cookieFrom(rotated)!

    // Push the rotation outside the race window.
    await db.authSession.updateMany({
      data: { refreshRotatedAt: new Date(Date.now() - 60_000) },
    })

    const replay = await runtime.app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: firstCookie },
    })

    expect(replay.status).toBe(401)
    expect(await errorCode(replay)).toBe('AUTH_SESSION_COMPROMISED')

    // The session is revoked: the current credential is dead too.
    const afterRevocation = await runtime.app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: secondCookie },
    })
    expect(afterRevocation.status).toBe(401)
  })

  test('logout revokes the credential and clears the cookie', async () => {
    const loginResponse = await login(admin.email, admin.password)
    const cookie = cookieFrom(loginResponse)!

    const logout = await runtime.app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie },
    })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')

    const refresh = await runtime.app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { cookie },
    })
    expect(refresh.status).toBe(401)
  })

  test('the access token authenticates, and the role comes from the database on every request', async () => {
    // Create an editor; the editor cannot list users.
    const passwords = createPasswordService()
    const editorUser = await db.user.create({
      data: {
        email: editor.email,
        passwordHash: await passwords.hash(editor.password),
        role: 'editor',
      },
    })

    const editorLogin = await login(editor.email, editor.password)
    const editorAccess = (await bodyOf<AuthBody>(editorLogin)).accessToken

    const listAsEditor = await runtime.app.request('/api/users', {
      headers: { authorization: `Bearer ${editorAccess}` },
    })
    expect(listAsEditor.status).toBe(403)

    // Demote in the database; the very same token must now resolve the new role.
    await db.user.update({ where: { id: editorUser.id }, data: { role: 'viewer' } })

    const listAfterDemotion = await runtime.app.request('/api/users', {
      headers: { authorization: `Bearer ${editorAccess}` },
    })
    expect(listAfterDemotion.status).toBe(403)

    const me = await runtime.app.request('/api/users/me', {
      headers: { authorization: `Bearer ${editorAccess}` },
    })
    expect(me.status).toBe(200)
    expect((await bodyOf<MeBody>(me)).user.role).toBe('viewer')
  })

  test('an unknown or expired access token is rejected', async () => {
    expect(
      (await runtime.app.request('/api/users/me', { headers: { authorization: 'Bearer garbage' } }))
        .status,
    ).toBe(401)
    expect((await runtime.app.request('/api/users/me')).status).toBe(401)
  })

  test('the last administrator cannot be demoted', async () => {
    const adminLogin = await login(admin.email, admin.password)
    const adminAccess = (await bodyOf<AuthBody>(adminLogin)).accessToken
    const me = await runtime.app.request('/api/users/me', {
      headers: { authorization: `Bearer ${adminAccess}` },
    })
    const adminId = (await bodyOf<MeBody>(me)).user.id

    const demote = await runtime.app.request(`/api/users/${adminId}/role`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminAccess}`,
        'content-type': 'application/json',
        origin: 'https://app.pipupi.ru',
      },
      body: JSON.stringify({ role: 'viewer' }),
    })

    expect(demote.status).toBe(409)
    expect(await errorCode(demote)).toBe('LAST_ADMIN')
  })

  test('an admin creates accounts and a duplicate email is a conflict', async () => {
    const adminLogin = await login(admin.email, admin.password)
    const adminAccess = (await bodyOf<AuthBody>(adminLogin)).accessToken
    const request = (body: unknown) =>
      runtime.app.request('/api/users', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminAccess}`,
          'content-type': 'application/json',
          origin: 'https://app.pipupi.ru',
        },
        body: JSON.stringify(body),
      })

    const created = await request({ email: 'new@pipupi.ru', password: 'long-enough-password' })
    expect(created.status).toBe(201)
    expect((await bodyOf<{ role: string }>(created)).role).toBe('viewer')

    const duplicate = await request({ email: 'new@pipupi.ru', password: 'long-enough-password' })
    expect(duplicate.status).toBe(409)

    const invalid = await request({ email: 'not-an-email', password: 'short' })
    expect(invalid.status).toBe(400)
  })

  test('state-changing requests with a foreign Origin are rejected regardless of CORS', async () => {
    const response = await runtime.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ email: admin.email, password: admin.password }),
    })

    expect(response.status).toBe(403)
    expect(await errorCode(response)).toBe('ORIGIN_REJECTED')
  })

  test('state-changing requests with an allowed Origin pass', async () => {
    const response = await runtime.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.pipupi.ru' },
      body: JSON.stringify({ email: admin.email, password: admin.password }),
    })

    expect(response.status).toBe(200)
  })

  test('authentication attempts are rate limited per client', async () => {
    const limitedRuntime = createRuntime({ ...env, authRateLimitMax: 3 })
    try {
      const attempt = () =>
        limitedRuntime.app.request('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
          body: JSON.stringify({ email: admin.email, password: 'wrong-password' }),
        })

      for (let i = 0; i < 3; i++) {
        expect((await attempt()).status).toBe(401)
      }
      const limited = await attempt()
      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).not.toBeNull()
    } finally {
      await limitedRuntime.close()
    }
  })

  test('the session cookie is host-only: two different hosts do not share it', async () => {
    // The API listens on 127.0.0.2 and the "public site" on 127.0.0.1 — different hosts,
    // so a cookie scoping test here cannot be fooled by the localhost-port trap described
    // in docs/DOMAINS.md section 7.
    const apiServer = Bun.serve({ port: 0, hostname: '127.0.0.2', fetch: runtime.app.fetch })
    const siteServer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (request) => new Response(request.headers.get('cookie') ?? '<none>'),
    })

    // A minimal cookie jar with browser semantics: cookies are stored per host and only
    // attached to requests for that host. Host-only cookies (no Domain) never cross hosts.
    const jar = new Map<string, string[]>()

    try {
      const loginResponse = await fetch(`http://127.0.0.2:${apiServer.port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: admin.email, password: admin.password }),
      })
      expect(loginResponse.status).toBe(200)

      const setCookie = loginResponse.headers.get('set-cookie')!
      expect(setCookie).not.toMatch(/Domain/i)
      const { accessToken } = await bodyOf<AuthBody>(loginResponse)
      jar.set('127.0.0.2', [setCookie.split(';')[0]!])

      // The site host gets no auth cookie from the jar.
      const toSite = await fetch(`http://127.0.0.1:${siteServer.port}/probe`, {
        headers: jar.has('127.0.0.1') ? { cookie: jar.get('127.0.0.1')!.join('; ') } : {},
      })
      expect(await toSite.text()).toBe('<none>')

      // The API host receives it and authenticates.
      const toApi = await fetch(`http://127.0.0.2:${apiServer.port}/api/users/me`, {
        headers: {
          cookie: jar.get('127.0.0.2')!.join('; '),
          authorization: `Bearer ${accessToken}`,
        },
      })
      expect(toApi.status).toBe(200)
    } finally {
      apiServer.stop(true)
      siteServer.stop(true)
    }
  })
})
