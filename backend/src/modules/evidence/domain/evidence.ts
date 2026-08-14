/**
 * Pure rules of the evidence registry (docs/GEO.md).
 *
 * The one load-bearing predicate: which claims content is allowed to use. Everything else
 * in the registry is storage; this is the rule that makes verification meaningful.
 */

export interface ClaimUsabilityShape {
  verifiedAt: Date | null
  supersededById: string | null
}

/** A claim is usable by content only when a human verified it and no correction replaced it. */
export function isUsableClaim(claim: ClaimUsabilityShape): boolean {
  return claim.verifiedAt !== null && claim.supersededById === null
}

export type ClaimStatus = 'verified' | 'unverified' | 'superseded'

export function claimStatus(claim: ClaimUsabilityShape): ClaimStatus {
  if (claim.supersededById !== null) return 'superseded'
  return claim.verifiedAt !== null ? 'verified' : 'unverified'
}
