/**
 * Ports of the auth context. The application layer depends on these interfaces only —
 * the infrastructure layer implements them with Prisma, jose and Bun's Argon2id. The
 * interfaces speak product language: nothing here is a database or a JWT.
 */

import type { UserRole } from '@traffic/contracts'

export interface UserRecord {
  id: string
  email: string
  displayName: string | null
  role: UserRole
  passwordHash: string | null
  createdAt: Date
}

export interface PublicUser {
  id: string
  email: string
  displayName: string | null
  role: UserRole
  createdAt: Date
}

export interface SessionRecord {
  id: string
  userId: string
  refreshTokenHash: string | null
  previousRefreshTokenHash: string | null
  refreshRotatedAt: Date | null
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}

export interface Principal {
  userId: string
  sessionId: string
  role: UserRole
}

export interface AuthSettings {
  accessTokenTtlSeconds: number
  refreshTokenTtlDays: number
  sessionAbsoluteTtlDays: number
  /** A refresh token replayed within this window after rotation is a race, not a breach. */
  rotationRaceWindowMs: number
}

export interface Clock {
  now(): Date
}

export interface PasswordService {
  hash(password: string): Promise<string>
  verify(password: string, hash: string): Promise<boolean>
}

export interface AccessTokenService {
  sign(input: { userId: string; sessionId: string }): Promise<string>
  verify(token: string): Promise<{ userId: string; sessionId: string } | null>
}

export interface RefreshTokenService {
  generate(): string
  hash(token: string): string
}

export interface SessionStore {
  create(input: {
    userId: string
    refreshTokenHash: string
    userAgent: string | null
    ipAddress: string | null
    expiresAt: Date
  }): Promise<{ id: string; userId: string }>

  findByRefreshHash(hash: string): Promise<SessionRecord | null>

  /** Valid means: not revoked and not expired. The caller checks the absolute TTL. */
  findValidById(id: string, now: Date): Promise<SessionRecord | null>

  /** Atomic rotation. Returns false when the hash is no longer current — the race was lost. */
  rotate(currentHash: string, newHash: string, rotatedAt: Date): Promise<boolean>

  /** Revokes whatever session carries this hash, current or previous. */
  revokeByRefreshHash(hash: string): Promise<boolean>

  /** Retention: expired or long-revoked sessions are pruned periodically. */
  deleteExpired(before: Date): Promise<number>
}

export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>
  findById(id: string): Promise<UserRecord | null>
}
