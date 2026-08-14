/**
 * The DeepSeek driver (docs/CHECKLIST.md section 8: DEEPSEEK_BASE_URL, DEEPSEEK_MODEL).
 *
 * Real model calls are gated twice: this driver is never wired by default, and it refuses
 * to call without an API key. Live usage is exercised only by the `*.live.test.ts` suite
 * against a real service — never by the default test runs, and never by CI.
 *
 * The prompt goes out; the response comes back; nothing is retained here — the recorder
 * wrapper stores a hash and the usage, not the text (docs/DEPLOYMENT.md section 7).
 */

import type {
  GenerateBriefInput,
  GenerateBriefOutput,
  GenerateDraftInput,
  GenerateDraftOutput,
  LlmPort,
  LlmResult,
} from './port'

export interface DeepseekDriverOptions {
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
  maxOutputTokens: number
}

export class DeepseekUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeepseekUnavailableError'
  }
}

interface DeepseekMessage {
  role: 'system' | 'user'
  content: string
}

interface DeepseekResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

const systemPrompt =
  'Ты — редактор SEO-контента. Пиши по-русски. Помечай места, требующие проверки фактов человеком, явными маркерами. Не выдумывай характеристики, цены и нормативы.'

function toJson(markdown: string): unknown {
  const start = markdown.indexOf('{')
  const end = markdown.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new DeepseekUnavailableError('model response contained no JSON object')
  }
  return JSON.parse(markdown.slice(start, end + 1))
}

export function createDeepseekDriver(options: DeepseekDriverOptions): LlmPort {
  const call = async (purpose: string, payload: unknown): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> => {
    if (!options.apiKey) {
      throw new DeepseekUnavailableError(
        'DEEPSEEK_API_KEY is not configured; the DeepSeek driver cannot make real calls',
      )
    }

    const messages: DeepseekMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${purpose}:\n${JSON.stringify(payload)}` },
    ]

    let response: Response
    try {
      response = await fetch(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          max_tokens: options.maxOutputTokens,
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
      })
    } catch (error) {
      throw new DeepseekUnavailableError(
        `DeepSeek request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (!response.ok) {
      throw new DeepseekUnavailableError(`DeepSeek answered ${response.status}`)
    }

    const body = (await response.json()) as DeepseekResponse
    const text = body.choices?.[0]?.message?.content
    if (!text) {
      throw new DeepseekUnavailableError('DeepSeek returned no completion content')
    }

    return {
      text,
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      },
    }
  }

  return {
    async generateBrief(input: GenerateBriefInput): Promise<LlmResult<GenerateBriefOutput>> {
      const { text, usage } = await call('Сгенерируй структурированный бриф статьи в виде JSON', {
        keywords: input.keywords,
        clusterTitle: input.clusterTitle,
        productNames: input.productNames,
        regionNames: input.regionNames,
        audience: input.audience,
        tone: input.tone,
        instructions: input.instructions,
      })
      return {
        content: toJson(text) as GenerateBriefOutput,
        usage: { ...usage, costMinorUnits: null, costCurrency: null },
      }
    },

    async generateDraft(input: GenerateDraftInput): Promise<LlmResult<GenerateDraftOutput>> {
      const { text, usage } = await call('Напиши черновик статьи по брифу в виде JSON', {
        briefTitle: input.briefTitle,
        briefOutline: input.briefOutline,
        keywords: input.keywords,
        clusterTitle: input.clusterTitle,
        productNames: input.productNames,
        regionNames: input.regionNames,
        audience: input.audience,
        tone: input.tone,
      })
      return {
        content: toJson(text) as GenerateDraftOutput,
        usage: { ...usage, costMinorUnits: null, costCurrency: null },
      }
    },
  }
}
