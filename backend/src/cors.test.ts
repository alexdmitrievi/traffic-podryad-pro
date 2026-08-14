import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { createCorsMiddleware } from './cors'

const config = {
  publicOrigins: ['https://pipupi.ru'],
  appOrigins: ['https://app.pipupi.ru'],
}

function buildApp() {
  const app = new Hono()
  app.use('*', createCorsMiddleware(config))
  app.get('/api/public/ping', (c) => c.json({ ok: true }))
  app.get('/api/users', (c) => c.json({ ok: true }))
  app.get('/health', (c) => c.json({ ok: true }))
  return app
}

describe('CORS', () => {
  test('the app policy answers with credentials for the app origin', async () => {
    const response = await buildApp().request('/api/users', {
      headers: { origin: 'https://app.pipupi.ru' },
    })

    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.pipupi.ru')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })

  test('the public policy answers without credentials for the site origin', async () => {
    const response = await buildApp().request('/api/public/ping', {
      headers: { origin: 'https://pipupi.ru' },
    })

    expect(response.headers.get('access-control-allow-origin')).toBe('https://pipupi.ru')
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
  })

  test('a foreign origin gets no CORS headers', async () => {
    const response = await buildApp().request('/api/users', {
      headers: { origin: 'https://evil.example' },
    })

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('the app origin is not accepted by the public policy', async () => {
    const response = await buildApp().request('/api/public/ping', {
      headers: { origin: 'https://app.pipupi.ru' },
    })

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('OPTIONS preflight on the app policy', async () => {
    const response = await buildApp().request('/api/users', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.pipupi.ru',
        'access-control-request-method': 'POST',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('access-control-allow-methods')).toContain('PATCH')
  })

  test('health routes carry no CORS headers', async () => {
    const response = await buildApp().request('/health', {
      headers: { origin: 'https://app.pipupi.ru' },
    })

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
