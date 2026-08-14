/**
 * Pure rules of the GEO query inventory (docs/GEO.md unit 2).
 *
 * The lifecycle is the rule: a question is triaged open → planned → answered, or
 * dismissed at any triage point. Dismissal is terminal and records why; answered is
 * terminal and means an answer asset exists (unit 4 links it here).
 */

import type { GeoQueryStatus } from '@traffic/contracts'

export const allowedTransitions: Record<GeoQueryStatus, GeoQueryStatus[]> = {
  open: ['planned', 'dismissed'],
  planned: ['answered', 'dismissed'],
  answered: [],
  dismissed: [],
}

export const terminalStatuses: GeoQueryStatus[] = ['answered', 'dismissed']

/** A dismissal must say why: a closed question without a reason cannot be audited. */
export function transitionAllowed(from: GeoQueryStatus, to: GeoQueryStatus): boolean {
  return allowedTransitions[from]?.includes(to) ?? false
}
