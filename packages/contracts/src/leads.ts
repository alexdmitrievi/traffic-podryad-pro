import { z } from 'zod'
import {
  idSchema,
  isoDateTimeSchema,
  mediumTextSchema,
  shortTextSchema,
  workspaceIdSchema,
} from './common'
import { measurementUnitSchema } from './catalog'

/**
 * Lead capture.
 *
 * This is the one contract that carries personal data, which makes two things true of it:
 * consent is structural rather than a checkbox the UI can skip, and nothing here may ever
 * reach the LLM provider layer — enforced by rule AC-2 and by `PII_TO_LLM_ALLOWED=false`.
 */

export const leadStatusSchema = z.enum([
  'new',
  'qualified',
  'contacted',
  'converted',
  'rejected',
  'spam',
])

/** Russian phone in normalized form: 11 digits starting with 7. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^7\d{10}$/, 'phone must be 11 digits starting with 7')

export const utmSchema = z.object({
  utmSource: shortTextSchema.nullable(),
  utmMedium: shortTextSchema.nullable(),
  utmCampaign: shortTextSchema.nullable(),
  utmContent: shortTextSchema.nullable(),
  utmTerm: shortTextSchema.nullable(),
})

export const leadSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,

  // What they want.
  productId: idSchema.nullable(),
  volume: z.number().positive().nullable(),
  volumeUnit: measurementUnitSchema.nullable(),
  deliveryRegionId: idSchema.nullable(),
  deliveryBasisId: idSchema.nullable(),

  // Who they are. Personal data.
  companyName: shortTextSchema.nullable(),
  inn: z.string().trim().regex(/^\d{10}$|^\d{12}$/).nullable(),
  contactName: shortTextSchema,
  phone: phoneSchema.nullable(),
  email: z.email().nullable(),
  message: mediumTextSchema.nullable(),

  // Where they came from.
  landingPath: z.string().trim().max(2048).nullable(),
  contentItemId: idSchema.nullable(),
  ...utmSchema.shape,

  /**
   * Consent is not optional and not nullable. A lead without a recorded consent moment cannot
   * exist in this system, and the server rejects the submission rather than storing one.
   * The versions record which wording the person actually agreed to.
   */
  consentAt: isoDateTimeSchema,
  consentTextVersion: shortTextSchema,
  privacyPolicyVersion: shortTextSchema,

  /** Normalized contact plus product. A repeat submission adds a touch, not a second lead. */
  dedupeHash: z.string().length(64),
  status: leadStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

/**
 * The public CTA form.
 *
 * `consent` must be literally `true`: an unchecked box is a rejected request, verified on the
 * server rather than hidden in the interface. `visitorId` links the submission to the touches
 * already recorded for this browser.
 */
export const submitLeadRequestSchema = z
  .object({
    productId: idSchema.optional(),
    volume: z.number().positive().optional(),
    volumeUnit: measurementUnitSchema.optional(),
    deliveryRegionId: idSchema.optional(),
    deliveryBasisId: idSchema.optional(),
    companyName: shortTextSchema.optional(),
    inn: z.string().trim().regex(/^\d{10}$|^\d{12}$/).optional(),
    contactName: shortTextSchema,
    phone: phoneSchema.optional(),
    email: z.email().optional(),
    message: mediumTextSchema.optional(),

    visitorId: idSchema.optional(),
    landingPath: z.string().trim().max(2048).optional(),
    contentItemId: idSchema.optional(),
    utmSource: shortTextSchema.optional(),
    utmMedium: shortTextSchema.optional(),
    utmCampaign: shortTextSchema.optional(),
    utmContent: shortTextSchema.optional(),
    utmTerm: shortTextSchema.optional(),

    consent: z.literal(true),
    consentTextVersion: shortTextSchema,
    privacyPolicyVersion: shortTextSchema,

    /** Honeypot. Anything here means a bot, and the request is dropped quietly. */
    website: z.string().max(0).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.phone ?? value.email), {
    message: 'at least one of phone or email is required',
    path: ['phone'],
  })

export const submitLeadResponseSchema = z.object({
  accepted: z.literal(true),
})

export type LeadStatus = z.infer<typeof leadStatusSchema>
export type Lead = z.infer<typeof leadSchema>
export type SubmitLeadRequest = z.infer<typeof submitLeadRequestSchema>
export type SubmitLeadResponse = z.infer<typeof submitLeadResponseSchema>
