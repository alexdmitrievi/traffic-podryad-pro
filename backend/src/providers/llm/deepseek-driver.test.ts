/**
 * Unit tests for the DeepSeek billing math (docs/CONTENT_PIPELINE.md "Стоимость и
 * предохранитель"). The pure function is tested here without any network call; live
 * behaviour against the real service belongs to deepseek.live.test.ts, which never runs
 * in CI.
 */

import { describe, expect, test } from 'bun:test'
import { deepseekCostMinorUnitsRub, DeepseekUnavailableError, createDeepseekDriver } from './deepseek-driver'

const pricing = {
  inputPriceUsdPer1m: 0.435,
  outputPriceUsdPer1m: 0.87,
  usdToRubRate: 90,
}

describe('deepseekCostMinorUnitsRub', () => {
  test('bills input and output tokens separately and converts USD to RUB kopecks', () => {
    // 1M input = $0.435, 1M output = $0.87 → $1.305 → × 90 RUB = 117.45 RUB → 11 745 kopecks.
    expect(
      deepseekCostMinorUnitsRub({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, pricing),
    ).toBe(11_745)
  })

  test('rounds up so the cap never underestimates the bill', () => {
    // 1 token of input = $0.435/1M = $0.000000435 → × 90 = 0.00003915 RUB → 0.003915 kopecks.
    expect(deepseekCostMinorUnitsRub({ inputTokens: 1, outputTokens: 0 }, pricing)).toBe(1)
  })

  test('zero tokens is a zero bill, not a missing one', () => {
    expect(deepseekCostMinorUnitsRub({ inputTokens: 0, outputTokens: 0 }, pricing)).toBe(0)
  })

  test('absent provider usage counts as zero tokens', () => {
    expect(deepseekCostMinorUnitsRub({ inputTokens: undefined, outputTokens: undefined }, pricing)).toBe(0)
  })

  test('missing pricing is a null cost, not a fabricated one', () => {
    expect(
      deepseekCostMinorUnitsRub({ inputTokens: 1_000, outputTokens: 1_000 }, {
        inputPriceUsdPer1m: null,
        outputPriceUsdPer1m: null,
        usdToRubRate: null,
      }),
    ).toBeNull()
  })
})

describe('the DeepSeek driver without a key', () => {
  test('refuses before any network call', async () => {
    const driver = createDeepseekDriver({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      apiKey: '',
      timeoutMs: 1_000,
      maxOutputTokens: 100,
      pricing,
    })

    const brief = {
      keywords: ['дизельное топливо оптом'],
      clusterTitle: 'Оптовая покупка дизельного топлива',
      productNames: ['Дизельное топливо'],
      regionNames: ['Омск'],
      audience: null,
      tone: null,
      instructions: [],
    }

    let error: unknown = null
    try {
      await driver.generateBrief(brief)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(DeepseekUnavailableError)
  })
})
