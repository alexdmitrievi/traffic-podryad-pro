import type {
  AccessTokenService,
  Clock,
  PasswordService,
  PublicUser,
  RefreshTokenService,
  SessionStore,
  UserRecord,
  UserStore,
} from './ports'

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  }
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

export interface AuthenticateDeps {
  users: UserStore
  passwords: PasswordService
  sessions: SessionStore
  refreshTokens: RefreshTokenService
  accessTokens: AccessTokenService
  settings: { refreshTokenTtlDays: number; accessTokenTtlSeconds: number }
  clock: Clock
}

export interface AuthenticateInput {
  email: string
  password: string
  userAgent: string | null
  ipAddress: string | null
}

export interface AuthenticateResult {
  user: PublicUser
  accessToken: string
  refreshToken: string
  sessionId: string
}

/**
 * Login. Returns null for unknown email or wrong password — the transport answers both
 * with the same 401 so the endpoint is not an account-enumeration oracle.
 */
export async function authenticate(
  deps: AuthenticateDeps,
  input: AuthenticateInput,
): Promise<AuthenticateResult | null> {
  const user = await deps.users.findByEmail(input.email)
  if (!user || !user.passwordHash) return null

  const valid = await deps.passwords.verify(input.password, user.passwordHash)
  if (!valid) return null

  const refreshToken = deps.refreshTokens.generate()
  const session = await deps.sessions.create({
    userId: user.id,
    refreshTokenHash: deps.refreshTokens.hash(refreshToken),
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
    expiresAt: addDays(deps.clock.now(), deps.settings.refreshTokenTtlDays),
  })
  const accessToken = await deps.accessTokens.sign({ userId: user.id, sessionId: session.id })

  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken,
    sessionId: session.id,
  }
}
