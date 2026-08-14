/**
 * Live suite for the DeepSeek driver — runs against the real service, never in CI and
 * never in the default test runs (docs/TESTING.md section 1: `*.live.test.ts`).
 *
 * Requires DEEPSEEK_API_KEY in the environment; without it the suite is skipped. Real
 * calls cost money, so this file stays out of every automated run on purpose.
 */

import { describe, test } from 'bun:test'
import { runLlmContractSuite } from './contract-suite'
import { createDeepseekDriver } from './deepseek-driver'

const apiKey = process.env.DEEPSEEK_API_KEY ?? ''
const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro'

describe.skipIf(!apiKey)('the DeepSeek driver against the real service', () => {
  const driver = createDeepseekDriver({
    baseUrl,
    model,
    apiKey,
    timeoutMs: 120_000,
    maxOutputTokens: 4096,
  })

  runLlmContractSuite(driver)

  test('a missing key is refused before any network call', () => {
    const keyless = createDeepseekDriver({ baseUrl, model, apiKey: '', timeoutMs: 1_000, maxOutputTokens: 100 })
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
})
