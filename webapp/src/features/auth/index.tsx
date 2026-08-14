/**
 * The auth feature: login screen and the session hook. The refresh credential stays in
 * the HttpOnly cookie; the access token lives in memory only (docs/WEB_SURFACES.md).
 */

import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api, getAccessToken, login, logout } from '../../platform/api'
import { Alert, Button, Card, Field } from '../../components/ui'

export interface MeResponse {
  user: { id: string; email: string; role: string }
}

export function useAuthed(): boolean {
  return getAccessToken() !== null
}

export async function fetchMe(): Promise<MeResponse> {
  return api<MeResponse>('GET', '/api/users/me')
}

export async function logoutSession(): Promise<void> {
  await logout()
}

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (getAccessToken()) return <Navigate to="/" replace />

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      onLogin()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Вход не удался')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <Card title="Вход">
        {error ? <Alert kind="error">{error}</Alert> : null}
        <form onSubmit={submit}>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              data-testid="login-email"
            />
          </Field>
          <Field label="Пароль">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              data-testid="login-password"
            />
          </Field>
          <Button type="submit" disabled={busy} data-testid="login-submit">
            Войти
          </Button>
        </form>
      </Card>
    </div>
  )
}
