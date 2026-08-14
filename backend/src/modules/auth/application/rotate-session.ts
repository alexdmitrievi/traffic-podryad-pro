import { decideRotationOutcome } from '../domain/rotation'
import { addDays, toPublicUser } from './authenticate'
import type {
  AccessTokenService,
  Clock,
  PublicUser,
  RefreshTokenService,
  SessionStore,
  UserStore,
} from './ports'

export interface RotateSessionDeps {
  users: UserStore
  sessions: SessionStore
  refreshTokens: RefreshTokenService
  accessTokens: AccessTokenService
  settings: { accessTokenTtlSeconds: number; sessionAbsoluteTtlDays: number; rotationRaceWindowMs: number }
  clock: Clock
}

export type RotateResult =
  | { kind: 'rotated'; user: PublicUser; accessToken: string; refreshToken: string; sessionId: string }
  | { kind: 'reused'; user: PublicUser; accessToken: string; sessionId: string }
  | { kind: 'revoked' }
  | { kind: 'invalid' }

/**
 * Refresh rotation. The protocol (docs/ARCHITECTURE.md section 10):
 *   - the presented token is current → rotate; the client gets a new credential;
 *   - the presented token is previous and the rotation was inside the race window → a
 *     concurrent refresh already rotated; succeed idempotently WITHOUT issuing a new
 *     credential (the client already holds it);
 *   - the presented token is previous and the window closed → a stolen credential is the
 *     likeliest explanation; revoke the session;
 *   - unknown, expired or revoked → invalid.
 *
 * The two-attempt loop covers the narrow race where two concurrent refreshes both read the
 * same current hash: one rotation wins, the loser re-reads and sees its token as previous.
 */
export async function rotateSession(
  deps: RotateSessionDeps,
  refreshToken: string,
): Promise<RotateResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const hash = deps.refreshTokens.hash(refreshToken)
    const session = await deps.sessions.findByRefreshHash(hash)
    if (!session) return { kind: 'invalid' }

    const now = deps.clock.now()
    if (session.revokedAt !== null || session.expiresAt.getTime() <= now.getTime()) {
      return { kind: 'invalid' }
    }
    const absoluteExpiry = addDays(session.createdAt, deps.settings.sessionAbsoluteTtlDays)
    if (absoluteExpiry.getTime() <= now.getTime()) {
      return { kind: 'invalid' }
    }

    const user = await deps.users.findById(session.userId)
    if (!user) return { kind: 'invalid' }

    const outcome = decideRotationOutcome({
      matched: session.refreshTokenHash === hash ? 'current' : 'previous',
      rotatedAt: session.refreshRotatedAt,
      now,
      raceWindowMs: deps.settings.rotationRaceWindowMs,
    })

    if (outcome === 'revoke_session') {
      await deps.sessions.revokeByRefreshHash(hash)
      return { kind: 'revoked' }
    }

    if (outcome === 'reuse_within_window') {
      const accessToken = await deps.accessTokens.sign({ userId: user.id, sessionId: session.id })
      return { kind: 'reused', user: toPublicUser(user), accessToken, sessionId: session.id }
    }

    const newRefreshToken = deps.refreshTokens.generate()
    const rotated = await deps.sessions.rotate(hash, deps.refreshTokens.hash(newRefreshToken), now)
    if (!rotated) continue // lost the race; the second pass sees this token as previous

    const accessToken = await deps.accessTokens.sign({ userId: user.id, sessionId: session.id })
    return {
      kind: 'rotated',
      user: toPublicUser(user),
      accessToken,
      refreshToken: newRefreshToken,
      sessionId: session.id,
    }
  }

  return { kind: 'invalid' }
}
