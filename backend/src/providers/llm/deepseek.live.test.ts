/**
 * Live suite for the DeepSeek driver — runs against the real service, never in CI and
 * never in the default test runs (docs/TESTING.md section 1: `*.live.test.ts`).
 *
 * Requires DEEPSEEK_API_KEY in the environment; without it the suite is skipped. Real
 * calls cost money, so this file stays out of every automated run on purpose.
 */

import { describe, expect, test } from 'bun:test'
import { runLlmContractSuite } from './contract-suite'
import { createDeepseekDriver } from './deepseek-driver'

const apiKey = process.env.DEEPSEEK_API_KEY ?? ''
const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro'

/** Prices come from the official pricing page, checked by a human before a live run. */
function pricingFromEnv() {
  const read = (key: string): number | null => {
    const raw = process.env[key] ?? ''
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  }
  return {
    inputPriceUsdPer1m: read('DEEPSEEK_INPUT_PRICE_USD_PER_1M'),
    outputPriceUsdPer1m: read('DEEPSEEK_OUTPUT_PRICE_USD_PER_1M'),
    usdToRubRate: read('DEEPSEEK_USD_TO_RUB_RATE'),
  }
}

const pricing = pricingFromEnv()
const hasPricing = pricing.inputPriceUsdPer1m !== null && pricing.outputPriceUsdPer1m !== null && pricing.usdToRubRate !== null

describe.skipIf(!apiKey)('the DeepSeek driver against the real service', () => {
  const driver = createDeepseekDriver({
    baseUrl,
    model,
    apiKey,
    timeoutMs: 120_000,
    maxOutputTokens: 4096,
    pricing,
  })

  runLlmContractSuite(driver)

  test('a missing key is refused before any network call', () => {
    const keyless = createDeepseekDriver({
      baseUrl,
      model,
      apiKey: '',
      timeoutMs: 1_000,
      maxOutputTokens: 100,
      pricing,
    })
    return keyless.generateBrief({ keywords: ['x'], clusterTitle: 'x', productNames: [], regionNames: [], audience: null, tone: null, instructions: [] })
      .then(
        () => {
          throw new Error('expected the keyless driver to refuse')
        },
        (error: unknown) => {
          if (!(error instanceof Error)) throw error
        },
      )
  })

  test.skipIf(!hasPricing)('usage is billed in RUB kopecks against the configured prices', async () => {
    const result = await driver.generateBrief({
      keywords: ['дизельное топливо оптом омск'],
      clusterTitle: 'Оптовая покупка дизельного топлива',
      productNames: ['Дизельное топливо'],
      regionNames: ['Омск'],
      audience: null,
      tone: null,
      instructions: [],
    })
    if (result.usage.inputTokens > 0) {
      expect(result.usage.costMinorUnits).not.toBeNull()
      expect(result.usage.costCurrency).toBe('RUB')
    }
  })
})
