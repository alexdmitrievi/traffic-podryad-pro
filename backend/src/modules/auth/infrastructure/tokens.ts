import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import type { AccessTokenService, RefreshTokenService } from '../application/ports'

/**
 * Short-lived HS256 access tokens via jose, and opaque refresh credentials.
 * The refresh credential is never returned in JSON — only its hash is stored
 * (docs/ARCHITECTURE.md section 10).
 */
export function createAccessTokenService(secret: string, ttlSeconds: number): AccessTokenService {
  const key = new TextEncoder().encode(secret)

  return {
    async sign({ userId, sessionId }) {
      return new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setJti(sessionId)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(key)
    },
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
        const userId = typeof payload.sub === 'string' ? payload.sub : null
        const sessionId = typeof payload.jti === 'string' ? payload.jti : null
        if (!userId || !sessionId) return null
        return { userId, sessionId }
      } catch {
        return null
      }
    },
  }
}

export function createRefreshTokenService(): RefreshTokenService {
  return {
    generate() {
      return randomBytes(32).toString('base64url')
    },
    hash(token) {
      return createHash('sha256').update(token).digest('hex')
    },
  }
}
