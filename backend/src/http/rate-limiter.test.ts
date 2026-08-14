import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { createRateLimiter } from './rate-limiter'

function buildApp(limiter: ReturnType<typeof createRateLimiter>) {
  const app = new Hono()
  app.use('/api/auth/*', limiter.middleware)
  app.post('/api/auth/login', (c) => c.json({ ok: true }))
  return app
}

describe('the auth rate limiter', () => {
  test('allows up to the window maximum and then answers 429 with Retry-After', async () => {
    let now = 1_000_000
    const limiter = createRateLimiter(
      { max: 3, windowMs: 60_000, trustedProxyIpHeader: 'x-forwarded-for' },
      () => now,
    )
    const app = buildApp(limiter)
    const request = () =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
        body: '{}',
      })

    for (let i = 0; i < 3; i++) {
      expect((await request()).status).toBe(200)
    }

    const limited = await request()
    expect(limited.status).toBe(429)
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED')
    expect(limited.headers.get('retry-after')).not.toBeNull()
  })

  test('the window resets once it elapses', async () => {
    let now = 1_000_000
    const limiter = createRateLimiter(
      { max: 1, windowMs: 60_000, trustedProxyIpHeader: 'x-forwarded-for' },
      () => now,
    )
    const app = buildApp(limiter)
    const request = () =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.8' },
        body: '{}',
      })

    expect((await request()).status).toBe(200)
    expect((await request()).status).toBe(429)

    now += 61_000
    expect((await request()).status).toBe(200)
  })

  test('limits are per client IP', async () => {
    let now = 1_000_000
    const limiter = createRateLimiter(
      { max: 1, windowMs: 60_000, trustedProxyIpHeader: 'x-forwarded-for' },
      () => now,
    )
    const app = buildApp(limiter)
    const request = (ip: string) =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: '{}',
      })

    expect((await request('203.0.113.9')).status).toBe(200)
    expect((await request('203.0.113.10')).status).toBe(200)
    expect((await request('203.0.113.9')).status).toBe(429)
  })
})
