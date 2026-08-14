/**
 * Service request state machine — pure transition rules (docs/SERVICE_REQUESTS.md
 * section 2).
 */

import type { ServiceLine, ServiceRequestStatus } from '@traffic/contracts'

export type TransitionActor = 'admin' | 'editor' | 'viewer' | 'system'

export interface TransitionInput {
  from: ServiceRequestStatus
  to: ServiceRequestStatus
  actor: TransitionActor
  line: ServiceLine
  reason: string | null
}

export type TransitionResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_transition' | 'reason_required' | 'not_executable_line' | 'capability_terminal' }

const terminal: ServiceRequestStatus[] = [
  'delivered',
  'planned_awaiting_capability',
  'partially_delivered',
  'rejected',
  'cancelled',
]

const reasonRequired: ServiceRequestStatus[] = ['rejected', 'on_hold', 'cancelled']

/**
 * The complete transition table. Anything not listed is refused. The MVP has exactly one
 * executable line; the planning-only lines terminate in `planned_awaiting_capability`,
 * which is a success, not an error — and there is deliberately no path from it to
 * `in_delivery` for them.
 */
export function canTransition(input: TransitionInput): TransitionResult {
  if (terminal.includes(input.from)) {
    return { ok: false, reason: 'invalid_transition' }
  }
  if (reasonRequired.includes(input.to) && !(input.reason ?? '').trim()) {
    return { ok: false, reason: 'reason_required' }
  }

  const allowed = new Map<ServiceRequestStatus, ServiceRequestStatus[]>([
    ['draft', ['submitted', 'cancelled']],
    ['submitted', ['triage', 'cancelled']],
    ['triage', ['accepted', 'rejected']],
    ['accepted', ['planning', 'on_hold', 'cancelled']],
    ['planning', ['plan_approved', 'on_hold', 'cancelled']],
    ['plan_approved', ['in_delivery', 'planned_awaiting_capability', 'on_hold', 'cancelled']],
    ['in_delivery', ['delivered', 'on_hold', 'cancelled']],
    ['on_hold', ['planning', 'cancelled']],
  ])

  const targets = allowed.get(input.from)
  if (!targets?.includes(input.to)) {
    return { ok: false, reason: 'invalid_transition' }
  }

  // The capability gate: only seo_content has delivery in the MVP, and only the
  // planning-only lines may terminate in the deliberate capability state.
  if (input.to === 'in_delivery' && input.line !== 'seo_content') {
    return { ok: false, reason: 'not_executable_line' }
  }
  if (input.to === 'planned_awaiting_capability' && input.line === 'seo_content') {
    return { ok: false, reason: 'invalid_transition' }
  }

  return { ok: true }
}
