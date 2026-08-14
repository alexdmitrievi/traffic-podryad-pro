import type { MiddlewareHandler } from 'hono'
import type { Principal } from '../application/ports'

export interface AuthContext {
  Variables: {
    principal: Principal
  }
}

export type AuthMiddleware = MiddlewareHandler<AuthContext>

/**
 * Resolves the acting principal from the Bearer access token on every request. The role
 * comes from the database through the session — never from the token — so a demotion takes
 * effect on the next request (docs/ARCHITECTURE.md section 10).
 */
export function createRequireAuth(
  resolve: (accessToken: string) => Promise<Principal | null>,
): AuthMiddleware {
  return async (c, next) => {
    const header = c.req.header('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
    if (!token) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        401,
      )
    }

    const principal = await resolve(token)
    if (!principal) {
      return c.json(
        { error: { code: 'AUTH_SESSION_EXPIRED', message: 'Session expired or revoked' } },
        401,
      )
    }

    c.set('principal', principal)
    await next()
  }
}

/** Must run after `requireAuth`: reads the principal it stored. */
export function createRequireRole(...roles: string[]): AuthMiddleware {
  return async (c, next) => {
    const principal = c.get('principal')
    if (!principal || !roles.includes(principal.role)) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient role' } },
        403,
      )
    }
    await next()
  }
}
