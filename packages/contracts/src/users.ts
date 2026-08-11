import { z } from 'zod'
import { idSchema, isoDateTimeSchema } from './common'

/**
 * Roles and profiles.
 *
 * Three roles, not two. `admin` is the sole approver in the MVP; `editor` produces content
 * and plans but cannot approve or publish; `viewer` reads. The separation exists now so the
 * "approver is not the author" policy can be switched on later without re-labelling history —
 * see docs/SERVICE_REQUESTS.md section 5.
 *
 * Roles are never encoded in a token. Authorization resolves the current role from the active
 * session on every request, so a demotion takes effect immediately.
 */
export const userRoleSchema = z.enum(['admin', 'editor', 'viewer'])

export const userSchema = z.object({
  id: idSchema,
  email: z.email(),
  displayName: z.string().nullable(),
  role: userRoleSchema,
  createdAt: isoDateTimeSchema,
})

export const updateProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80).nullable(),
  })
  .strict()

export const changeRoleRequestSchema = z
  .object({
    role: userRoleSchema,
  })
  .strict()

export const userListResponseSchema = z.object({
  users: z.array(userSchema),
})

export type UserRole = z.infer<typeof userRoleSchema>
export type User = z.infer<typeof userSchema>
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>
export type ChangeRoleRequest = z.infer<typeof changeRoleRequestSchema>
