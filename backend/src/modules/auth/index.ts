/**
 * The auth module's public surface: transport routes and the middleware every other module
 * uses to guard its own routes. The application layer depends on ports; this file is the
 * only place where the concrete infrastructure adapters are wired in — the module's
 * boundaries hold inside, its consumers see `createAuthModule` and the middleware.
 */

import { Hono } from 'hono'
import type { Db } from '../../db'
import type { AuthSettings } from './application/ports'
import { authenticate } from './application/authenticate'
import { logout, resolvePrincipal } from './application/principal'
import { rotateSession } from './application/rotate-session'
import { createPasswordService } from './infrastructure/password'
import { createSessionStore } from './infrastructure/session-store'
import { createAccessTokenService, createRefreshTokenService } from './infrastructure/tokens'
import { createUserStore } from './infrastructure/user-store'
import type { CookieSettings } from './transport/cookie'
import { createRequireAuth, createRequireRole } from './transport/middleware'
import type { AuthMiddleware } from './transport/middleware'
import { createRateLimiter } from '../../http/rate-limiter'
import type { RateLimitSettings } from '../../http/rate-limiter'
import { createAuthRoutes } from './transport/routes'

export interface AuthModuleDeps {
  db: Db
  settings: AuthSettings
  cookie: CookieSettings
  refreshTokenTtlDays: number
  rateLimit: RateLimitSettings
  jwtSecret: string
}

export interface AuthModule {
  routes: Hono
  requireAuth: AuthMiddleware
  requireRole: (...roles: string[]) => AuthMiddleware
}

// Re-exported so other modules stay within their boundaries: the auth module's public
// index is the only sanctioned cross-module import surface (docs/ARCHITECTURE.md section 3).
export { toPublicUser } from './application/authenticate'
export type { AuthSettings, PasswordService, PublicUser, UserRecord } from './application/ports'
export { createPasswordService } from './infrastructure/password'
export type { AuthContext, AuthMiddleware } from './transport/middleware'

export function createAuthModule(deps: AuthModuleDeps): AuthModule {
  const users = createUserStore(deps.db)
  const sessions = createSessionStore(deps.db)
  const passwords = createPasswordService()
  const accessTokens = createAccessTokenService(deps.jwtSecret, deps.settings.accessTokenTtlSeconds)
  const refreshTokens = createRefreshTokenService()
  const clock = { now: () => new Date() }

  const routes = createAuthRoutes({
    authenticate: (input) =>
      authenticate(
        {
          users,
          passwords,
          sessions,
          refreshTokens,
          accessTokens,
          settings: {
            refreshTokenTtlDays: deps.settings.refreshTokenTtlDays,
            accessTokenTtlSeconds: deps.settings.accessTokenTtlSeconds,
          },
          clock,
        },
        input,
      ),
    rotateSession: (token) =>
      rotateSession(
        { users, sessions, refreshTokens, accessTokens, settings: deps.settings, clock },
        token,
      ),
    logout: (token) => logout({ sessions, refreshTokens }, token),
    cookie: deps.cookie,
    refreshTokenTtlDays: deps.refreshTokenTtlDays,
    trustedProxyIpHeader: deps.rateLimit.trustedProxyIpHeader,
    rateLimit: createRateLimiter(deps.rateLimit).middleware,
  })

  const resolve = (token: string) => resolvePrincipal({ users, sessions, accessTokens, clock }, token)

  return {
    routes,
    requireAuth: createRequireAuth(resolve),
    requireRole: createRequireRole,
  }
}

/** Periodic retention task: prunes expired and long-revoked sessions. */
export function createSessionCleanup(db: Db, retentionDays: number): () => Promise<void> {
  const sessions = createSessionStore(db)
  return async () => {
    const before = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    const deleted = await sessions.deleteExpired(before)
    if (deleted > 0) {
      console.log(`[auth] cleaned up ${deleted} expired session(s)`)
    }
  }
}
