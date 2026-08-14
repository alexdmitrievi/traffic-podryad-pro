/**
 * Origin verification for state-changing methods (docs/DOMAINS.md section 4.1).
 *
 * The session cookie accompanies every request to the API — including top-level
 * navigations from foreign sites, which `SameSite=Lax` lets through for safe methods.
 * The compensating control is this middleware: for POST, PATCH, PUT and DELETE the
 * `Origin` header is checked against the exact allowlist of the route's policy,
 * independently of CORS (CORS is about who may read responses; this is about who may
 * trigger changes).
 *
 * A missing Origin is allowed: browsers send Origin on cross-origin state-changing
 * requests, and a request without one comes from a non-browser client (curl, the cron
 * runner), which a CSRF attack cannot be.
 */

import type { MiddlewareHandler } from 'hono'

export interface OriginCheckConfig {
  publicOrigins: string[]
  appOrigins: string[]
}

const stateChangingMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

export function createOriginCheckMiddleware(config: OriginCheckConfig): MiddlewareHandler {
  return async (c, next) => {
    if (!stateChangingMethods.has(c.req.method)) {
      await next()
      return
    }

    const origin = c.req.header('origin')
    if (!origin) {
      await next()
      return
    }

    const allowedOrigins = c.req.path.startsWith('/api/public/')
      ? config.publicOrigins
      : config.appOrigins

    if (!allowedOrigins.includes(origin)) {
      return c.json(
        {
          error: {
            code: 'ORIGIN_REJECTED',
            message: `Origin "${origin}" is not allowed for this route policy`,
          },
        },
        403,
      )
    }

    await next()
  }
}
