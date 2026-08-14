/**
 * The CSV driver: the only keyword source in the MVP (docs/CONTENT_PIPELINE.md step 2).
 *
 * Zero network calls, full format control, and an all-or-nothing rule: the file is either
 * accepted and fully parsed, or rejected with every problem listed. Rows after the limit
 * are a rejection too — silently truncating an import is how a campaign loses its tail.
 *
 * The accepted format is a header row followed by data rows:
 *
 *   phrase,volume
 *   дизельное топливо оптом омск,320
 *   купить дт,40
 *
 * `volume` is optional and may be empty; `phrase` is required on every row. Anything the
 * exporting tool appends beyond these columns is ignored — the product cares about the
 * phrase and the volume, not about the exporter's bookkeeping.
 */

import type {
  KeywordImportInput,
  KeywordImportProblem,
  KeywordImportResult,
  KeywordSourcePort,
} from './port'
import { KeywordImportRejectedError } from './port'

export interface CsvDriverOptions {
  maxRows: number
}

export function createCsvKeywordDriver(options: CsvDriverOptions): KeywordSourcePort {
  return {
    async importKeywords(input: KeywordImportInput): Promise<KeywordImportResult> {
      const problems: KeywordImportProblem[] = []

      const lines = input.csv
        .split(/\r?\n/)
        .map((line) => line.trimEnd())

      const header = lines[0]
      if (!header) {
        throw new KeywordImportRejectedError('The CSV file is empty', [{ line: null, message: 'the file contains no rows' }])
      }

      const columns = header
        .split(',')
        .map((column) => column.trim().toLowerCase())
      if (!columns.includes('phrase')) {
        throw new KeywordImportRejectedError('The CSV header must contain a "phrase" column', [
          { line: 1, message: `header ${JSON.stringify(header)} has no "phrase" column` },
        ])
      }
      const phraseIndex = columns.indexOf('phrase')
      const volumeIndex = columns.indexOf('volume')

      const dataLines = lines.slice(1)
      const nonBlankLines = dataLines.filter((line) => line.trim() !== '')
      if (nonBlankLines.length === 0) {
        throw new KeywordImportRejectedError('The CSV file has no data rows', [
          { line: 2, message: 'at least one keyword row is required' },
        ])
      }
      if (nonBlankLines.length > options.maxRows) {
        throw new KeywordImportRejectedError(
          `The CSV file has ${nonBlankLines.length} rows; the limit is ${options.maxRows}`,
          [{ line: null, message: `row limit ${options.maxRows} exceeded by ${nonBlankLines.length - options.maxRows} row(s)` }],
        )
      }

      const rows = []
      for (let index = 0; index < dataLines.length; index++) {
        const lineNumber = index + 2
        const line = dataLines[index] ?? ''
        if (line.trim() === '') continue

        const cells = line.split(',')
        const phrase = (cells[phraseIndex] ?? '').trim()
        if (phrase === '') {
          problems.push({ line: lineNumber, message: 'the phrase is empty' })
          continue
        }

        const rawVolume = volumeIndex === -1 ? '' : (cells[volumeIndex] ?? '').trim()
        let volume: number | null = null
        if (rawVolume !== '') {
          const parsed = Number(rawVolume)
          if (!Number.isInteger(parsed) || parsed < 0) {
            problems.push({ line: lineNumber, message: `volume "${rawVolume}" is not a non-negative integer` })
            continue
          }
          volume = parsed
        }

        rows.push({ phrase, volume })
      }

      if (problems.length > 0) {
        throw new KeywordImportRejectedError(
          `The CSV file was rejected: ${problems.length} invalid row(s)`,
          problems,
        )
      }

      return { rows }
    },
  }
}
