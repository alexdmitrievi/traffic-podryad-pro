/**
 * A fixed-window in-memory rate limiter (docs/DOMAINS.md section 4.1, docs/COMPLIANCE.md).
 *
 * One process in the MVP, so an in-memory counter is the right first answer — a shared
 * store is infrastructure the measured need for which does not exist yet
 * (docs/ARCHITECTURE.md section 6). The key is the client IP, read through the trusted
 * proxy header so the limits hold behind the CDN, not against the proxy's own address.
 * Shared by the auth routes and the public lead-capture routes.
 */

import type { MiddlewareHandler } from 'hono'

export interface RateLimitSettings {
  max: number
  windowMs: number
  trustedProxyIpHeader: string
}

export interface RateLimiter {
  middleware: MiddlewareHandler
  /** Visible for tests: the number of windows currently tracked. */
  size(): number
}

interface Window {
  start: number
  count: number
}

export function createRateLimiter(settings: RateLimitSettings, now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, Window>()

  function clientIp(header: string | undefined): string {
    if (!header) return 'unknown'
    const first = header.split(',')[0]
    return first ? first.trim() : 'unknown'
  }

  return {
    middleware: async (c, next) => {
      if (windows.size > 10_000) {
        const current = now()
        for (const [key, window] of windows) {
          if (current - window.start >= settings.windowMs) windows.delete(key)
        }
      }

      const ip = clientIp(c.req.header(settings.trustedProxyIpHeader))
      const current = now()
      const window = windows.get(ip)

      if (window && current - window.start < settings.windowMs) {
        window.count += 1
        if (window.count > settings.max) {
          const retryAfter = Math.ceil((window.start + settings.windowMs - current) / 1000)
          c.header('Retry-After', String(Math.max(1, retryAfter)))
          return c.json(
            {
              error: {
                code: 'RATE_LIMITED',
                message: 'Too many authentication attempts; retry later',
              },
            },
            429,
          )
        }
      } else {
        windows.set(ip, { start: current, count: 1 })
      }

      await next()
    },
    size() {
      return windows.size
    },
  }
}
