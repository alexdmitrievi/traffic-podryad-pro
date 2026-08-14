import { describe, expect, test } from 'bun:test'
import { buildClearCookie, buildSetCookie } from './cookie'
import type { CookieSettings } from './cookie'

const settings: CookieSettings = {
  name: 'pip_rt',
  path: '/',
  sameSite: 'lax',
  secure: true,
}

describe('the session cookie', () => {
  test('carries exactly the mandated attributes', () => {
    const cookie = buildSetCookie(settings, 'opaque-token', 2_592_000)

    expect(cookie).toBe(
      'pip_rt=opaque-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure',
    )
  })

  test('never carries a Domain attribute — host-only is implemented by absence', () => {
    const cookie = buildSetCookie(settings, 'opaque-token', 60)
    expect(cookie).not.toMatch(/Domain/i)
  })

  test('Secure appears only when configured', () => {
    const localCookie = buildSetCookie({ ...settings, secure: false }, 't', 60)
    expect(localCookie).not.toMatch(/Secure/)
    expect(buildSetCookie(settings, 't', 60)).toMatch(/Secure/)
  })

  test('SameSite follows the configured value', () => {
    expect(buildSetCookie({ ...settings, sameSite: 'strict' }, 't', 60)).toMatch(/SameSite=Strict/)
  })

  test('the clear cookie expires immediately and keeps the attribute set', () => {
    const cookie = buildClearCookie(settings)
    expect(cookie).toContain('pip_rt=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure')
    expect(cookie).not.toMatch(/Domain/i)
  })
})
