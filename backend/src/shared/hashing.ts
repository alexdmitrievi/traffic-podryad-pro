/**
 * Canonical content hashing: the same value hashes the same way everywhere.
 *
 * Approvals bind to these hashes — a plan, a revision — so the canonicalization must be
 * stable across processes and restarts: keys sorted recursively, no whitespace, no
 * property ordering. SHA-256 hex, matching contracts.common.contentHashSchema.
 */

import { createHash } from 'node:crypto'

function canonical(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}
