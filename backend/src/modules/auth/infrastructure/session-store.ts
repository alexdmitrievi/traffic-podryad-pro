import type { Db } from '../../../db'
import type { SessionRecord, SessionStore } from '../application/ports'

interface StoredSession {
  id: string
  userId: string
  refreshTokenHash: string | null
  previousRefreshTokenHash: string | null
  refreshRotatedAt: Date | null
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}

function toSessionRecord(row: StoredSession): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    refreshTokenHash: row.refreshTokenHash,
    previousRefreshTokenHash: row.previousRefreshTokenHash,
    refreshRotatedAt: row.refreshRotatedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  }
}

export function createSessionStore(db: Db): SessionStore {
  return {
    async create(input) {
      const session = await db.authSession.create({
        data: {
          userId: input.userId,
          refreshTokenHash: input.refreshTokenHash,
          userAgent: input.userAgent,
          ipAddress: input.ipAddress,
          expiresAt: input.expiresAt,
        },
      })
      return { id: session.id, userId: session.userId }
    },

    async findByRefreshHash(hash) {
      const row = await db.authSession.findFirst({
        where: { OR: [{ refreshTokenHash: hash }, { previousRefreshTokenHash: hash }] },
      })
      return row ? toSessionRecord(row) : null
    },

    async findValidById(id, now) {
      const row = await db.authSession.findFirst({
        where: { id, revokedAt: null, expiresAt: { gt: now } },
      })
      return row ? toSessionRecord(row) : null
    },

    async rotate(currentHash, newHash, rotatedAt) {
      const result = await db.authSession.updateMany({
        where: { refreshTokenHash: currentHash },
        data: {
          refreshTokenHash: newHash,
          previousRefreshTokenHash: currentHash,
          refreshRotatedAt: rotatedAt,
        },
      })
      return result.count === 1
    },

    async revokeByRefreshHash(hash) {
      const now = new Date()
      // The hashes stay stored: `findValidById` and the revokedAt check in the rotation
      // use case already make a revoked session unusable, and keeping them means a
      // replayed credential is still routed to this session — and rejected.
      const result = await db.authSession.updateMany({
        where: {
          revokedAt: null,
          OR: [{ refreshTokenHash: hash }, { previousRefreshTokenHash: hash }],
        },
        data: { revokedAt: now },
      })
      return result.count > 0
    },

    async deleteExpired(before) {
      const result = await db.authSession.deleteMany({
        where: { OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }] },
      })
      return result.count
    },
  }
}
