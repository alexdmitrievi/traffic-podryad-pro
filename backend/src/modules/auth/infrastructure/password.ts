import type { PasswordService } from '../application/ports'

/**
 * Argon2id via Bun's built-in hasher — docs/ARCHITECTURE.md section 10 requires Argon2id,
 * and the runtime provides it natively, so no native dependency is needed.
 * Verification of a malformed hash returns false rather than throwing.
 */
export function createPasswordService(): PasswordService {
  return {
    async hash(password: string): Promise<string> {
      return Bun.password.hash(password, { algorithm: 'argon2id' })
    },
    async verify(password: string, hash: string): Promise<boolean> {
      try {
        return await Bun.password.verify(password, hash)
      } catch {
        return false
      }
    },
  }
}
