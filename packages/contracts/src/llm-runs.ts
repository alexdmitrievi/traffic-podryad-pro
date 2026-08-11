import { z } from 'zod'
import { idSchema, isoDateTimeSchema, workspaceIdSchema } from './common'

/**
 * One record per call to the model.
 *
 * Without this, the cost of a piece of content is invisible from day one and the question
 * "does this pay for itself" gets answered by feeling. It is also the input to the monthly
 * budget guard: `LLM_MONTHLY_COST_CAP_RUB` stops generation rather than producing a surprise
 * invoice.
 *
 * `promptHash` rather than the prompt text: enough to tell two calls apart and to correlate a
 * bad output with its input, without copying article drafts and keyword sets into a log that
 * is retained and shipped elsewhere.
 */

export const llmRunPurposeSchema = z.enum([
  'brief_generation',
  'draft_generation',
  'plan_generation',
])

export const llmRunStatusSchema = z.enum(['succeeded', 'failed', 'timed_out', 'skipped'])

export const llmRunSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  provider: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(128),
  purpose: llmRunPurposeSchema,
  promptHash: z.string().length(64),
  inputTokens: z.int().min(0).nullable(),
  outputTokens: z.int().min(0).nullable(),
  /** Integer minor units, so a cost never accumulates floating-point drift. */
  costMinorUnits: z.int().min(0).nullable(),
  costCurrency: z.string().length(3).nullable(),
  latencyMs: z.int().min(0).nullable(),
  status: llmRunStatusSchema,
  errorCode: z.string().trim().max(120).nullable(),
  createdAt: isoDateTimeSchema,
})

export const llmUsageSummarySchema = z.object({
  periodStart: isoDateTimeSchema,
  periodEnd: isoDateTimeSchema,
  runCount: z.int().min(0),
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  costMinorUnits: z.int().min(0),
  costCurrency: z.string().length(3),
  capMinorUnits: z.int().min(0).nullable(),
})

export type LlmRunPurpose = z.infer<typeof llmRunPurposeSchema>
export type LlmRunStatus = z.infer<typeof llmRunStatusSchema>
export type LlmRun = z.infer<typeof llmRunSchema>
export type LlmUsageSummary = z.infer<typeof llmUsageSummarySchema>
