/**
 * LlmRun recording and the monthly cost cap (docs/CONTENT_PIPELINE.md "Стоимость и
 * предохранитель").
 *
 * Every call writes an `llm_runs` row with the provider, model, purpose, prompt hash,
 * token counts, cost in integer minor units, latency and status. The prompt and the
 * completion are never stored and never logged — the hash is enough to correlate a bad
 * output with its input (docs/DEPLOYMENT.md section 7).
 *
 * The cap: when the current calendar month's recorded cost reaches the limit, generation
 * stops — a refusal, not a silent continuation. Costs that a provider did not report
 * (null) cannot trip the cap; prices are configured before real calls are enabled.
 */

import { createHash } from 'node:crypto'
import type { Db } from '../../db'
import type { LlmPort } from './port'

export class LlmBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmBudgetExceededError'
  }
}

export interface InstrumentationOptions {
  db: Db
  provider: string
  model: string
  /** The catalog workspace the runs are recorded under (created by the seed). */
  workspaceSlug: string
  /** Integer minor units; null = no cap. */
  monthlyCapMinorUnits: number | null
}

type Purpose = 'brief_generation' | 'draft_generation'

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex')
}

export function createInstrumentedLlmPort(inner: LlmPort, options: InstrumentationOptions): LlmPort {
  const { db, provider, model, monthlyCapMinorUnits, workspaceSlug } = options

  let workspaceIdPromise: Promise<string> | null = null
  const workspaceId = (): Promise<string> => {
    workspaceIdPromise ??= db.workspace
      .findUniqueOrThrow({ where: { slug: workspaceSlug } })
      .then((workspace) => workspace.id)
    return workspaceIdPromise
  }

  const spendThisMonth = async (): Promise<number> => {
    const rows = await db.llmRun.groupBy({
      by: ['provider'],
      where: { provider, createdAt: { gte: monthStart(new Date()) } },
      _sum: { costMinorUnits: true },
    })
    return rows[0]?._sum.costMinorUnits ?? 0
  }

  const record = async (input: {
    purpose: Purpose
    prompt: string
    status: 'succeeded' | 'failed' | 'timed_out' | 'skipped'
    inputTokens: number | null
    outputTokens: number | null
    costMinorUnits: number | null
    costCurrency: string | null
    latencyMs: number | null
    errorCode: string | null
  }): Promise<void> => {
    await db.llmRun.create({
      data: {
        workspaceId: await workspaceId(),
        provider,
        model,
        purpose: input.purpose,
        promptHash: hashPrompt(input.prompt),
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costMinorUnits: input.costMinorUnits,
        costCurrency: input.costCurrency,
        latencyMs: input.latencyMs,
        status: input.status,
        errorCode: input.errorCode,
      },
    })
  }

  const run = async <T>(
    purpose: Purpose,
    prompt: string,
    execute: () => Promise<{ content: T; usage: { inputTokens: number; outputTokens: number; costMinorUnits: number | null; costCurrency: string | null } }>,
  ): Promise<{ content: T; usage: { inputTokens: number; outputTokens: number; costMinorUnits: number | null; costCurrency: string | null } }> => {
    if (monthlyCapMinorUnits !== null && (await spendThisMonth()) >= monthlyCapMinorUnits) {
      await record({
        purpose,
        prompt,
        status: 'skipped',
        inputTokens: null,
        outputTokens: null,
        costMinorUnits: null,
        costCurrency: null,
        latencyMs: null,
        errorCode: 'LLM_BUDGET_EXCEEDED',
      })
      throw new LlmBudgetExceededError(
        `LLM monthly cost cap of ${monthlyCapMinorUnits} minor units reached; generation stopped`,
      )
    }

    const started = Date.now()
    try {
      const result = await execute()
      await record({
        purpose,
        prompt,
        status: 'succeeded',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costMinorUnits: result.usage.costMinorUnits,
        costCurrency: result.usage.costCurrency,
        latencyMs: Date.now() - started,
        errorCode: null,
      })
      return result
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      await record({
        purpose,
        prompt,
        status: timedOut ? 'timed_out' : 'failed',
        inputTokens: null,
        outputTokens: null,
        costMinorUnits: null,
        costCurrency: null,
        latencyMs: Date.now() - started,
        errorCode: 'LLM_UNAVAILABLE',
      })
      throw error
    }
  }

  return {
    async generateBrief(input) {
      const prompt = `generateBrief:${JSON.stringify(input)}`
      return run('brief_generation', prompt, () => inner.generateBrief(input))
    },
    async generateDraft(input) {
      const prompt = `generateDraft:${JSON.stringify(input)}`
      return run('draft_generation', prompt, () => inner.generateDraft(input))
    },
  }
}
