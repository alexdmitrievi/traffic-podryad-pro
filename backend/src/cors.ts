/**
 * The two CORS policies (docs/DOMAINS.md section 5).
 *
 * One backend, two audiences:
 *   - `/api/public/*` — the static website, no credentials; `visitor_id` travels in the
 *     request body, so `Access-Control-Allow-Credentials` is `false`;
 *   - everything else — the authenticated application, with credentials.
 *
 * Origins are exact values from the environment, never a wildcard: with credentials a
 * wildcard is not even permitted by the specification, and without them it is just
 * openness nobody asked for. Routes outside `/api/*` (health) carry no CORS headers.
 */

import type { MiddlewareHandler } from 'hono'

export interface CorsConfig {
  publicOrigins: string[]
  appOrigins: string[]
}

const publicPathPrefix = '/api/public/'

export function createCorsMiddleware(config: CorsConfig): MiddlewareHandler {
  return async (c, next) => {
    if (!c.req.path.startsWith('/api/')) {
      await next()
      return
    }

    const isPublic = c.req.path.startsWith(publicPathPrefix)
    const allowedOrigins = isPublic ? config.publicOrigins : config.appOrigins
    const origin = c.req.header('origin')

    if (origin && allowedOrigins.includes(origin)) {
      c.header('Access-Control-Allow-Origin', origin)
      if (!isPublic) {
        c.header('Access-Control-Allow-Credentials', 'true')
      }
      c.header('Vary', 'Origin')
      c.header(
        'Access-Control-Allow-Methods',
        isPublic ? 'GET, POST, OPTIONS' : 'GET, POST, PATCH, DELETE, OPTIONS',
      )
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      c.header('Access-Control-Max-Age', '600')
    }

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204)
    }

    await next()
  }
}
