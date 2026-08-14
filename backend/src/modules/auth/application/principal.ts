import type {
  AccessTokenService,
  Clock,
  Principal,
  RefreshTokenService,
  SessionStore,
  UserStore,
} from './ports'

export interface PrincipalDeps {
  users: UserStore
  sessions: SessionStore
  accessTokens: AccessTokenService
  clock: Clock
}

/**
 * Resolves the acting principal for an access token. The role comes from the database on
 * every request — never from the token — so a role change takes effect immediately, which
 * is what the demotion test proves.
 */
export async function resolvePrincipal(deps: PrincipalDeps, accessToken: string): Promise<Principal | null> {
  const claims = await deps.accessTokens.verify(accessToken)
  if (!claims) return null

  const session = await deps.sessions.findValidById(claims.sessionId, deps.clock.now())
  if (!session || session.userId !== claims.userId) return null

  const user = await deps.users.findById(session.userId)
  if (!user) return null

  return { userId: user.id, sessionId: session.id, role: user.role }
}

export interface LogoutDeps {
  sessions: SessionStore
  refreshTokens: RefreshTokenService
}

export async function logout(deps: LogoutDeps, refreshToken: string): Promise<void> {
  await deps.sessions.revokeByRefreshHash(deps.refreshTokens.hash(refreshToken))
}
