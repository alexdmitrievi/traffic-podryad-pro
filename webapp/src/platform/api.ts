/**
 * The API client: the only place that talks HTTP. The session cookie travels with
 * credentials; the access token lives in memory and is refreshed on 401.
 *
 * The refresh credential is never stored in localStorage or any JS-readable store —
 * it stays in the HttpOnly cookie (docs/DOMAINS.md section 4.1).
 */

let accessToken: string | null = null
let refreshPromise: Promise<boolean> | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

async function refresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const response = await fetch('/api/auth/refresh', { method: 'POST' })
      if (!response.ok) {
        accessToken = null
        return false
      }
      const body = (await response.json()) as { accessToken: string }
      accessToken = body.accessToken
      return true
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

export interface ApiError {
  code: string
  message: string
}

export class ApiErrorResponse extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(error.message)
    this.name = 'ApiErrorResponse'
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const attempt = async (): Promise<Response> =>
    fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

  let response = await attempt()
  if (response.status === 401 && accessToken) {
    const refreshed = await refresh()
    if (refreshed) response = await attempt()
  }

  if (!response.ok) {
    let error: ApiError = { code: 'INTERNAL_ERROR', message: `HTTP ${response.status}` }
    try {
      const payload = (await response.json()) as { error?: ApiError }
      if (payload.error) error = payload.error
    } catch {
      // A non-JSON error body keeps the generic message.
    }
    throw new ApiErrorResponse(response.status, error)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function login(email: string, password: string): Promise<void> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    const payload = (await response.json()) as { error?: ApiError }
    throw new Error(payload.error?.message ?? 'Вход не удался')
  }
  const body = (await response.json()) as { accessToken: string }
  accessToken = body.accessToken
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
  accessToken = null
}
