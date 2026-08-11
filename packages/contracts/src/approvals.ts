import { z } from 'zod'
import {
  contentHashSchema,
  idSchema,
  isoDateTimeSchema,
  workspaceIdSchema,
} from './common'

/**
 * Approval is an entity, not a boolean.
 *
 * Four properties make it load-bearing rather than decorative:
 *
 *   1. it names the exact bytes that were approved, through `contentHash`;
 *   2. editing the subject changes that hash, which detaches the approval — nothing has to
 *      remember to re-approve, because a mismatched hash makes publication impossible;
 *   3. author and approver are recorded separately even when they are the same person, so
 *      the "approver is not the author" policy can be switched on later without re-labelling
 *      history;
 *   4. a rejection carries a reason.
 *
 * See docs/SERVICE_REQUESTS.md section 5.
 */

export const approvalSubjectTypeSchema = z.enum([
  'service_request_plan',
  'content_revision',
  'publication',
])

export const approvalDecisionSchema = z.enum(['approved', 'rejected'])

export const approvalSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  subjectType: approvalSubjectTypeSchema,
  subjectId: idSchema,
  /** The hash of the subject at the moment of the decision. */
  contentHash: contentHashSchema,
  decision: approvalDecisionSchema,
  decidedById: idSchema,
  decidedAt: isoDateTimeSchema,
  note: z.string().trim().max(2000).nullable(),
})

export const createApprovalSchema = z
  .object({
    subjectType: approvalSubjectTypeSchema,
    subjectId: idSchema,
    /**
     * The client sends the hash it believes it is approving. The server compares it with the
     * subject's current hash and refuses on mismatch, which is what stops an approval landing
     * on content that changed while the reviewer was reading it.
     */
    contentHash: contentHashSchema,
    decision: approvalDecisionSchema,
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((value) => value.decision !== 'rejected' || (value.note?.length ?? 0) > 0, {
    message: 'a rejection requires a note',
    path: ['note'],
  })

/** Whether a subject currently carries a valid approval, and why not when it does not. */
export const approvalStateSchema = z.object({
  subjectType: approvalSubjectTypeSchema,
  subjectId: idSchema,
  currentHash: contentHashSchema,
  approval: approvalSchema.nullable(),
  isApproved: z.boolean(),
  /** `stale` means an approval exists but points at an earlier hash. */
  reason: z.enum(['approved', 'never_approved', 'stale', 'rejected']),
})

export type ApprovalSubjectType = z.infer<typeof approvalSubjectTypeSchema>
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>
export type Approval = z.infer<typeof approvalSchema>
export type CreateApproval = z.infer<typeof createApprovalSchema>
export type ApprovalState = z.infer<typeof approvalStateSchema>
