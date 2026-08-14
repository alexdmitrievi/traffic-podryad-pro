import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { createOriginCheckMiddleware } from './origin-check'

const config = {
  publicOrigins: ['https://pipupi.ru'],
  appOrigins: ['https://app.pipupi.ru'],
}

function buildApp() {
  const app = new Hono()
  app.use('*', createOriginCheckMiddleware(config))
  app.post('/api/auth/logout', (c) => c.body(null, 204))
  app.post('/api/public/lead', (c) => c.body(null, 204))
  app.get('/api/users', (c) => c.json({ ok: true }))
  return app
}

describe('the origin check', () => {
  test('an allowed origin passes on the app policy', async () => {
    const response = await buildApp().request('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://app.pipupi.ru' },
    })
    expect(response.status).toBe(204)
  })

  test('an allowed origin passes on the public policy', async () => {
    const response = await buildApp().request('/api/public/lead', {
      method: 'POST',
      headers: { origin: 'https://pipupi.ru' },
    })
    expect(response.status).toBe(204)
  })

  test('a foreign origin is rejected with ORIGIN_REJECTED', async () => {
    const response = await buildApp().request('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('ORIGIN_REJECTED')
  })

  test('the app origin is rejected on the public policy', async () => {
    const response = await buildApp().request('/api/public/lead', {
      method: 'POST',
      headers: { origin: 'https://app.pipupi.ru' },
    })
    expect(response.status).toBe(403)
  })

  test('a state-changing request without an Origin is allowed: non-browser clients only', async () => {
    const response = await buildApp().request('/api/auth/logout', { method: 'POST' })
    expect(response.status).toBe(204)
  })

  test('GET requests are never origin-checked', async () => {
    const response = await buildApp().request('/api/users', {
      headers: { origin: 'https://evil.example' },
    })
    expect(response.status).toBe(200)
  })
})
