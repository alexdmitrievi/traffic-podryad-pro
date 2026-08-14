/**
 * The keyword source port (docs/ARCHITECTURE.md section 4).
 *
 * The MVP has exactly one source: a CSV export uploaded by a human. The port speaks
 * product language — an import request and its result — and knows nothing about files or
 * parsing; that is the driver's business.
 */

export interface KeywordRow {
  /** The raw phrase as it appeared in the file; normalization is the module's job. */
  phrase: string
  /** Optional search volume reported by the exporting tool. */
  volume: number | null
}

export interface KeywordImportInput {
  /** The raw CSV content, as uploaded. */
  csv: string
}

export interface KeywordImportResult {
  rows: KeywordRow[]
}

export interface KeywordImportProblem {
  line: number | null
  message: string
}

/**
 * A rejected import. The whole file is refused — a partial import leaves a state nobody
 * can describe (docs/CONTENT_PIPELINE.md step 2).
 */
export class KeywordImportRejectedError extends Error {
  constructor(
    message: string,
    public readonly problems: KeywordImportProblem[],
  ) {
    super(message)
    this.name = 'KeywordImportRejectedError'
  }
}

export interface KeywordSourcePort {
  importKeywords(input: KeywordImportInput): Promise<KeywordImportResult>
}
