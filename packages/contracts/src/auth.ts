import { z } from 'zod'
import { idSchema, isoDateTimeSchema } from './common'
import { userSchema } from './users'

/**
 * Authentication payloads.
 *
 * Two families of routes share one shape. Browser routes keep the refresh credential in a
 * host-only HttpOnly cookie and never return it in JSON; future native routes exchange it in
 * the body. The split lives in the transport layer — see docs/DOMAINS.md section 4 — but the
 * response shapes differ, so they are separate schemas rather than one optional field.
 */

export const emailSchema = z.email().trim().toLowerCase().max(254)

export const passwordSchema = z
  .string()
  .min(12, 'password must be at least 12 characters')
  .max(128, 'password must be at most 128 characters')

export const displayNameSchema = z.string().trim().min(2).max(80)

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
})

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})

/**
 * Browser refresh and logout carry no body: the credential travels in the cookie. The empty
 * strict object is what rejects a client that starts sending the token in JSON by mistake.
 */
export const cookieRefreshRequestSchema = z.object({}).strict()
export const cookieLogoutRequestSchema = z.object({}).strict()

export const cookieAuthResponseSchema = z
  .object({
    user: userSchema,
    accessToken: z.string().min(1),
  })
  .strict()

export const cookieRefreshResponseSchema = z
  .object({
    accessToken: z.string().min(1),
  })
  .strict()

export const meResponseSchema = z.object({
  user: userSchema,
})

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
})

/**
 * The response is identical whether or not the address exists. Anything else turns the
 * endpoint into an account-enumeration oracle.
 */
export const passwordResetRequestResponseSchema = z.object({
  accepted: z.literal(true),
})

export const passwordResetConfirmRequestSchema = z.object({
  token: z.string().trim().min(43).max(256),
  password: passwordSchema,
})

export const sessionSchema = z.object({
  id: idSchema,
  userId: idSchema,
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  revokedAt: isoDateTimeSchema.nullable(),
})

export type RegisterRequest = z.infer<typeof registerRequestSchema>
export type LoginRequest = z.infer<typeof loginRequestSchema>
export type CookieAuthResponse = z.infer<typeof cookieAuthResponseSchema>
export type MeResponse = z.infer<typeof meResponseSchema>
export type Session = z.infer<typeof sessionSchema>
