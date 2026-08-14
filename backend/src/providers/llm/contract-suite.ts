/**
 * The one contract suite for the LLM port, run against every driver
 * (docs/ARCHITECTURE.md section 4, docs/TESTING.md section 5).
 *
 * "Switching a provider is a configuration change, not a code change" is only true if
 * every driver passes the same behavioural tests. A driver that cannot answer these has
 * not implemented the port.
 */

import { describe, expect, test } from 'bun:test'
import type { LlmPort } from './port'

export const briefInput = {
  keywords: ['дизельное топливо оптом омск', 'купить дт тюмень'],
  clusterTitle: 'Оптовая покупка дизельного топлива',
  productNames: ['Дизельное топливо'],
  regionNames: ['Омск', 'Тюмень'],
  audience: 'Оптовые покупатели',
  tone: 'Деловой',
  instructions: ['Не выдумывать характеристики.'],
}

export const draftInput = {
  briefTitle: 'Как купить дизельное топливо оптом',
  briefOutline: [
    { heading: 'О предмете', intent: 'informational', factsToVerify: ['Проверить характеристики.'] },
  ],
  keywords: briefInput.keywords,
  clusterTitle: briefInput.clusterTitle,
  productNames: briefInput.productNames,
  regionNames: briefInput.regionNames,
  audience: briefInput.audience,
  tone: briefInput.tone,
}

export function runLlmContractSuite(driver: LlmPort): void {
  describe('LlmPort contract', () => {
    test('generateBrief returns a titled, structured brief', async () => {
      const result = await driver.generateBrief(briefInput)

      expect(result.content.title.length).toBeGreaterThan(0)
      expect(result.content.outline.length).toBeGreaterThan(0)
      expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0)
    })

    test('generateBrief outline sections carry the mandatory verification markers', async () => {
      const result = await driver.generateBrief(briefInput)

      for (const section of result.content.outline) {
        expect(section.heading.length).toBeGreaterThan(0)
        expect(Array.isArray(section.factsToVerify)).toBe(true)
      }
    })

    test('generateDraft returns markdown with meta fields and verification markers', async () => {
      const result = await driver.generateDraft(draftInput)

      expect(result.content.bodyMarkdown.length).toBeGreaterThan(0)
      expect(result.content.metaTitle.length).toBeGreaterThan(0)
      expect(result.content.metaDescription.length).toBeGreaterThan(0)
      expect(result.content.factsToVerify.length).toBeGreaterThan(0)
    })

    test('two calls with the same input produce the same shape', async () => {
      const first = await driver.generateBrief(briefInput)
      const second = await driver.generateBrief(briefInput)

      expect(second.content.outline.length).toBe(first.content.outline.length)
    })
  })
}
