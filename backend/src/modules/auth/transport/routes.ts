import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { contracts } from '@traffic/contracts'
import type { AuthenticateResult } from '../application/authenticate'
import type { RotateResult } from '../application/rotate-session'
import { buildClearCookie, buildSetCookie } from './cookie'
import type { CookieSettings } from './cookie'
import type { MiddlewareHandler } from 'hono'

export interface AuthRoutesDeps {
  authenticate(input: {
    email: string
    password: string
    userAgent: string | null
    ipAddress: string | null
  }): Promise<AuthenticateResult | null>
  rotateSession(refreshToken: string): Promise<RotateResult>
  logout(refreshToken: string): Promise<void>
  cookie: CookieSettings
  refreshTokenTtlDays: number
  trustedProxyIpHeader: string
  rateLimit: MiddlewareHandler
}

const daysToSeconds = (days: number) => days * 24 * 60 * 60

export function createAuthRoutes(deps: AuthRoutesDeps): Hono {
  const routes = new Hono()

  routes.use('*', deps.rateLimit)

  routes.post('/login', async (c) => {
    const parsed = contracts.auth.loginRequestSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid login payload' } },
        400,
      )
    }

    const result = await deps.authenticate({
      email: parsed.data.email,
      password: parsed.data.password,
      userAgent: c.req.header('user-agent') ?? null,
      ipAddress: c.req.header(deps.trustedProxyIpHeader) ?? null,
    })
    if (!result) {
      return c.json(
        { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password' } },
        401,
      )
    }

    c.header(
      'Set-Cookie',
      buildSetCookie(deps.cookie, result.refreshToken, daysToSeconds(deps.refreshTokenTtlDays)),
    )
    return c.json(
      contracts.auth.cookieAuthResponseSchema.parse({
        user: {
          ...result.user,
          createdAt: result.user.createdAt.toISOString(),
        },
        accessToken: result.accessToken,
      }),
    )
  })

  routes.post('/refresh', async (c) => {
    const refreshToken = getCookie(c, deps.cookie.name)
    if (!refreshToken) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401)
    }

    const result = await deps.rotateSession(refreshToken)

    if (result.kind === 'rotated') {
      c.header(
        'Set-Cookie',
        buildSetCookie(deps.cookie, result.refreshToken, daysToSeconds(deps.refreshTokenTtlDays)),
      )
      return c.json(
        contracts.auth.cookieRefreshResponseSchema.parse({ accessToken: result.accessToken }),
      )
    }

    if (result.kind === 'reused') {
      // A concurrent refresh already rotated the credential and the client holds the new
      // one. Succeed idempotently without issuing a second credential.
      return c.json(
        contracts.auth.cookieRefreshResponseSchema.parse({ accessToken: result.accessToken }),
      )
    }

    c.header('Set-Cookie', buildClearCookie(deps.cookie))
    if (result.kind === 'revoked') {
      return c.json(
        {
          error: {
            code: 'AUTH_SESSION_COMPROMISED',
            message: 'Refresh credential reused outside the rotation window; session revoked',
          },
        },
        401,
      )
    }
    return c.json(
      { error: { code: 'AUTH_SESSION_EXPIRED', message: 'Session expired or revoked' } },
      401,
    )
  })

  routes.post('/logout', async (c) => {
    const refreshToken = getCookie(c, deps.cookie.name)
    if (refreshToken) {
      await deps.logout(refreshToken)
    }
    c.header('Set-Cookie', buildClearCookie(deps.cookie))
    return c.body(null, 204)
  })

  return routes
}
