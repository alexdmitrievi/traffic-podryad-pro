/**
 * The one contract suite for the keyword source port, run against every driver.
 */

import { describe, expect, test } from 'bun:test'
import { KeywordImportRejectedError } from './port'
import type { KeywordSourcePort } from './port'

export const validCsv = [
  'phrase,volume',
  'дизельное топливо оптом омск,320',
  'купить дт тюмень,40',
  'мазут оптом,',
  '',
].join('\n')

export function runKeywordContractSuite(
  createDriver: (options: { maxRows: number }) => KeywordSourcePort,
): void {
  const driver = () => createDriver({ maxRows: 100 })

  describe('KeywordSourcePort contract', () => {
    test('a valid file parses fully, skipping blank lines', async () => {
      const result = await driver().importKeywords({ csv: validCsv })

      expect(result.rows).toHaveLength(3)
      expect(result.rows[0]).toEqual({ phrase: 'дизельное топливо оптом омск', volume: 320 })
      expect(result.rows[2]).toEqual({ phrase: 'мазут оптом', volume: null })
    })

    test('an empty file is rejected entirely', async () => {
      await expect(driver().importKeywords({ csv: '' })).rejects.toBeInstanceOf(
        KeywordImportRejectedError,
      )
    })

    test('a header without the phrase column is rejected entirely', async () => {
      await expect(
        driver().importKeywords({ csv: 'keyword,volume\nдизель,10\n' }),
      ).rejects.toBeInstanceOf(KeywordImportRejectedError)
    })

    test('a file with no data rows is rejected entirely', async () => {
      await expect(
        driver().importKeywords({ csv: 'phrase,volume\n' }),
      ).rejects.toBeInstanceOf(KeywordImportRejectedError)
    })

    test('one invalid row rejects the whole file with the row listed', async () => {
      const csv = ['phrase,volume', 'хороший запрос,10', 'ещё запрос,не-число'].join('\n')

      try {
        await driver().importKeywords({ csv })
        expect.unreachable('the import must be rejected')
      } catch (error) {
        expect(error).toBeInstanceOf(KeywordImportRejectedError)
        const problems = (error as KeywordImportRejectedError).problems
        expect(problems.some((problem) => problem.line === 3)).toBe(true)
      }
    })

    test('rows beyond the limit are a rejection, not a truncation', async () => {
      const csv = [
        'phrase',
        'запрос один',
        'запрос два',
        'запрос три',
      ].join('\n')

      await expect(createDriver({ maxRows: 2 }).importKeywords({ csv })).rejects.toBeInstanceOf(
        KeywordImportRejectedError,
      )
    })
  })
}
