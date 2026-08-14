import { describe, expect, test } from 'bun:test'
import { createApp } from './app'
import type { HealthProbe } from './app'

const cors = {
  publicOrigins: ['http://localhost:4321'],
  appOrigins: ['http://localhost:5173'],
}

/**
 * The probe that proves the liveness contract: every method throws, so any route that
 * touches the database fails the test instead of returning a false green.
 */
const poisonedProbe: HealthProbe = {
  ping: async () => {
    throw new Error('ping must not be called by /health or /health/live')
  },
  migrationsApplied: async () => {
    throw new Error('migrationsApplied must not be called by /health or /health/live')
  },
}

describe('health routes', () => {
  test('/health answers without touching the database', async () => {
    const app = createApp({ probe: poisonedProbe, cors })
    const response = await app.request('/health')

    expect(response.status).toBe(200)
  })

  test('/health/live answers without touching the database', async () => {
    const app = createApp({ probe: poisonedProbe, cors })
    const response = await app.request('/health/live')

    expect(response.status).toBe(200)
  })

  test('/health/ready is negative while the database is unreachable', async () => {
    const app = createApp({
      probe: {
        ping: async () => false,
        migrationsApplied: async () => {
          throw new Error('must not be reached when ping fails')
        },
      },
      cors,
    })

    const response = await app.request('/health/ready')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'not_ready', reason: 'database_unreachable' })
  })

  test('/health/ready is negative while migrations are pending', async () => {
    const app = createApp({
      probe: { ping: async () => true, migrationsApplied: async () => false },
      cors,
    })

    const response = await app.request('/health/ready')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'not_ready', reason: 'migrations_pending' })
  })

  test('/health/ready is positive when the database answers and migrations are applied', async () => {
    const app = createApp({
      probe: { ping: async () => true, migrationsApplied: async () => true },
      cors,
    })

    const response = await app.request('/health/ready')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready' })
  })

  test('a throwing probe yields a 503, not a crash', async () => {
    const app = createApp({
      probe: {
        ping: async () => {
          throw new Error('connection refused')
        },
        migrationsApplied: async () => true,
      },
      cors,
    })

    const response = await app.request('/health/ready')
    expect(response.status).toBe(503)
  })
})
