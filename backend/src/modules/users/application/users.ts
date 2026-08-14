import type { UserRole } from '@traffic/contracts'
import type { PasswordService, PublicUser, UserRecord } from '../../auth'
import { toPublicUser } from '../../auth'

export interface UsersDeps {
  users: UsersRepo
  passwords: PasswordService
}

export interface UsersRepo {
  findByEmail(email: string): Promise<UserRecord | null>
  findById(id: string): Promise<UserRecord | null>
  list(): Promise<UserRecord[]>
  create(input: {
    email: string
    passwordHash: string
    displayName: string | null
    role: UserRole
  }): Promise<UserRecord>
  changeRoleWithGuard(input: {
    targetId: string
    role: UserRole
  }): Promise<{ ok: boolean; reason?: 'not_found' | 'last_admin'; user?: UserRecord }>
}

export interface CreateUserInput {
  email: string
  password: string
  displayName?: string
  role?: UserRole
}

/** Returns null when the email is already taken. */
export async function createUser(deps: UsersDeps, input: CreateUserInput): Promise<PublicUser | null> {
  const existing = await deps.users.findByEmail(input.email)
  if (existing) return null

  const passwordHash = await deps.passwords.hash(input.password)
  const user = await deps.users.create({
    email: input.email,
    passwordHash,
    displayName: input.displayName ?? null,
    role: input.role ?? 'viewer',
  })
  return toPublicUser(user)
}

export type ChangeRoleResult =
  | { ok: true; user: PublicUser }
  | { ok: false; reason: 'not_found' | 'last_admin' }

/**
 * Role change with the zero-admins invariant: the last administrator cannot be demoted
 * (docs/ARCHITECTURE.md section 10). The invariant lives in the repository's serializable
 * transaction, where a concurrent change cannot slip between the count and the update.
 */
export async function changeUserRole(
  deps: UsersDeps,
  input: { targetId: string; role: UserRole },
): Promise<ChangeRoleResult> {
  const result = await deps.users.changeRoleWithGuard(input)
  if (!result.ok) return { ok: false, reason: result.reason ?? 'not_found' }
  return { ok: true, user: toPublicUser(result.user!) }
}
