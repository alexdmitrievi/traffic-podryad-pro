import { describe, expect, test } from 'bun:test'
import { runKeywordContractSuite } from './contract-suite'
import { createCsvKeywordDriver } from './csv-driver'

describe('the CSV keyword driver', () => {
  runKeywordContractSuite(createCsvKeywordDriver)

  test('the header order is irrelevant: phrase may follow volume', async () => {
    const driver = createCsvKeywordDriver({ maxRows: 100 })
    const result = await driver.importKeywords({
      csv: 'volume,phrase\n10,дизельное топливо\n',
    })

    expect(result.rows[0]).toEqual({ phrase: 'дизельное топливо', volume: 10 })
  })

  test('extra columns from the exporting tool are ignored', async () => {
    const driver = createCsvKeywordDriver({ maxRows: 100 })
    const result = await driver.importKeywords({
      csv: 'phrase,volume,position,url\nдизель,10,3,https://example.com\n',
    })

    expect(result.rows[0]).toEqual({ phrase: 'дизель', volume: 10 })
  })
})
