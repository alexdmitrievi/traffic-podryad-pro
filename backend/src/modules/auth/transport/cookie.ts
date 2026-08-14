/**
 * The session cookie builder. The attribute set is the security model
 * (docs/DOMAINS.md section 4.1): host-only (no Domain attribute, ever), Path=/, HttpOnly,
 * Secure in production, SameSite=Lax. A unit test pins every attribute so a regression in
 * the cookie string fails the build.
 */

export interface CookieSettings {
  name: string
  path: string
  sameSite: 'lax' | 'strict'
  secure: boolean
}

export function buildSetCookie(settings: CookieSettings, value: string, maxAgeSeconds: number): string {
  const parts = [
    `${settings.name}=${value}`,
    `Path=${settings.path}`,
    'HttpOnly',
    `SameSite=${settings.sameSite === 'lax' ? 'Lax' : 'Strict'}`,
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (settings.secure) parts.push('Secure')
  // No Domain attribute — its absence is what keeps the cookie on api.pipupi.ru only.
  return parts.join('; ')
}

export function buildClearCookie(settings: CookieSettings): string {
  return buildSetCookie(settings, '', 0)
}
