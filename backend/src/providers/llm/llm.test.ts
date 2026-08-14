import { describe, expect, test } from 'bun:test'
import { runLlmContractSuite } from './contract-suite'
import { createFakeLlmDriver } from './fake-driver'
import { findPii, createGuardedLlmPort, LlmGuardError } from './pii-guard'
import { hashPrompt } from './instrumentation'
import type { GenerateBriefInput, LlmPort } from './port'

const brief: GenerateBriefInput = {
  keywords: ['дизельное топливо оптом'],
  clusterTitle: 'Оптовая покупка дизельного топлива',
  productNames: ['Дизельное топливо'],
  regionNames: ['Омск'],
  audience: null,
  tone: null,
  instructions: ['Не выдумывать.'],
}

describe('the fake LLM driver', () => {
  runLlmContractSuite(createFakeLlmDriver())

  test('is deterministic across calls', async () => {
    const driver = createFakeLlmDriver()
    const first = await driver.generateBrief(brief)
    const second = await driver.generateBrief(brief)

    expect(JSON.stringify(first.content)).toBe(JSON.stringify(second.content))
  })
})

describe('the PII runtime guard', () => {
  test('a clean payload passes', async () => {
    const guarded = createGuardedLlmPort(createFakeLlmDriver())
    const result = await guarded.generateBrief(brief)

    expect(result.content.title).toContain(brief.clusterTitle)
  })

  test('a phone number anywhere in the payload is refused', async () => {
    const guarded = createGuardedLlmPort(createFakeLlmDriver())

    await expect(
      guarded.generateBrief({
        ...brief,
        instructions: ['Позвонить клиенту +7 900 123-45-67 и уточнить.'],
      }),
    ).rejects.toBeInstanceOf(LlmGuardError)
  })

  test('an email anywhere in the payload is refused', async () => {
    const guarded = createGuardedLlmPort(createFakeLlmDriver())

    await expect(
      guarded.generateDraft({
        briefTitle: 'Черновик',
        briefOutline: [{ heading: 'h', intent: null, factsToVerify: ['buyer@company.ru'] }],
        keywords: brief.keywords,
        clusterTitle: brief.clusterTitle,
        productNames: brief.productNames,
        regionNames: brief.regionNames,
        audience: null,
        tone: null,
      }),
    ).rejects.toBeInstanceOf(LlmGuardError)
  })

  test('an INN-shaped digit run is refused', () => {
    expect(findPii({ ...brief, instructions: ['ИНН 5505164012 проверить.'] })).toContain('inn')
  })

  test('ordinary keyword numbers are not flagged', () => {
    expect(findPii({ ...brief, keywords: ['бензин 92 95', 'мазут 100'] })).toEqual([])
  })
})

describe('prompt hashing', () => {
  test('is a stable sha-256 of the prompt text', () => {
    expect(hashPrompt('a')).toBe(hashPrompt('a'))
    expect(hashPrompt('a')).toHaveLength(64)
    expect(hashPrompt('a')).not.toBe(hashPrompt('b'))
  })
})
