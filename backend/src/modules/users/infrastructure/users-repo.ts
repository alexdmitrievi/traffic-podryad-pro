import type { UserRole } from '@traffic/contracts'
import { Prisma } from '../../../generated/prisma/client.ts'
import type { Db } from '../../../db'
import type { UserRecord } from '../../auth'
import type { UsersRepo } from '../application/users'

const MAX_RETRIES = 3

function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
}

/**
 * The zero-admins invariant is enforced here, inside a serializable transaction: the count
 * of remaining admins and the role update cannot be split by a concurrent change. A
 * serialization failure means another transaction won the race — the whole decision is
 * re-evaluated from scratch.
 */
export function createUsersRepo(db: Db): UsersRepo {
  return {
    async findByEmail(email) {
      const row = await db.user.findUnique({ where: { email } })
      return row as UserRecord | null
    },

    async findById(id) {
      const row = await db.user.findUnique({ where: { id } })
      return row as UserRecord | null
    },

    async list() {
      const rows = await db.user.findMany({ orderBy: { createdAt: 'asc' } })
      return rows as UserRecord[]
    },

    async create(input) {
      const row = await db.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
          role: input.role,
        },
      })
      return row as UserRecord
    },

    async changeRoleWithGuard(input) {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          return await db.$transaction(
            async (tx) => {
              const target = await tx.user.findUnique({ where: { id: input.targetId } })
              if (!target) return { ok: false as const, reason: 'not_found' as const }
              if (target.role === input.role) return { ok: true as const, user: target as UserRecord }

              if (target.role === 'admin') {
                const adminCount = await tx.user.count({ where: { role: 'admin' } })
                if (adminCount <= 1) {
                  return { ok: false as const, reason: 'last_admin' as const }
                }
              }

              const updated = await tx.user.update({
                where: { id: input.targetId },
                data: { role: input.role as UserRole },
              })
              return { ok: true as const, user: updated as UserRecord }
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          )
        } catch (error) {
          if (isSerializationFailure(error) && attempt < MAX_RETRIES - 1) continue
          throw error
        }
      }
      throw new Error('unreachable: retry loop exhausted')
    },
  }
}
