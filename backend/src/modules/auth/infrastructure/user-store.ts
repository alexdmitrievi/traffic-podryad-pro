import type { Db } from '../../../db'
import type { UserRecord, UserStore } from '../application/ports'

export function createUserStore(db: Db): UserStore {
  return {
    async findByEmail(email) {
      const row = await db.user.findUnique({ where: { email } })
      return row as UserRecord | null
    },
    async findById(id) {
      const row = await db.user.findUnique({ where: { id } })
      return row as UserRecord | null
    },
  }
}
