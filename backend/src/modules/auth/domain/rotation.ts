/**
 * The refresh-rotation race rule, as a pure function (docs/ARCHITECTURE.md section 10).
 *
 * A refresh token replayed while it is still the current hash rotates normally. A token
 * that already moved to `previousRefreshTokenHash` is either a legitimate rotation race —
 * two tabs refreshed at once, one response lost — or a stolen credential. The two are told
 * apart by the race window: reuse inside it succeeds idempotently without another
 * rotation; reuse outside it revokes the session.
 */

export type RotationOutcome = 'rotate' | 'reuse_within_window' | 'revoke_session'

export interface RotationInput {
  /** Which stored hash the presented token matched. */
  matched: 'current' | 'previous'
  /** When the last rotation happened, if it did. */
  rotatedAt: Date | null
  now: Date
  raceWindowMs: number
}

export function decideRotationOutcome(input: RotationInput): RotationOutcome {
  if (input.matched === 'current') return 'rotate'
  if (input.rotatedAt === null) return 'revoke_session'

  const elapsed = input.now.getTime() - input.rotatedAt.getTime()
  return elapsed <= input.raceWindowMs ? 'reuse_within_window' : 'revoke_session'
}
