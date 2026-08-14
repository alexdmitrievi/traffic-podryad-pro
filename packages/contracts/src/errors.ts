import { z } from 'zod'

/**
 * The single error envelope for the whole API.
 *
 * The code set is closed on purpose. A client can branch on a code; it cannot branch on a
 * message, and a message is free to change with translation or wording. Adding a code is a
 * contract change that both producer and consumers see.
 */
export const apiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',

  // Auth failures a client can act on, kept apart from the generic codes so the UI can say
  // what to do rather than "something went wrong".
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_SESSION_EXPIRED',
  // A refresh credential reused outside the rotation race window: the session was revoked.
  'AUTH_SESSION_COMPROMISED',
  // A state-changing request whose Origin header is not in the allowlist for its policy.
  'ORIGIN_REJECTED',
  // The zero-admins invariant: the last admin cannot be demoted.
  'LAST_ADMIN',

  // Approval and publication. These carry the product's central invariant, so they are
  // distinguishable from a generic CONFLICT: the operator needs to know whether the content
  // was never approved, or was approved and then edited.
  'APPROVAL_REQUIRED',
  'APPROVAL_STALE',
  'PUBLICATION_BLOCKED',

  // Service request lifecycle.
  'SERVICE_REQUEST_INVALID_TRANSITION',
  'CAPABILITY_NOT_AVAILABLE',

  // Lead capture.
  'CONSENT_REQUIRED',

  // Keyword import.
  'IMPORT_REJECTED',

  // LLM provider.
  'LLM_UNAVAILABLE',
  'LLM_BUDGET_EXCEEDED',
])

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>
