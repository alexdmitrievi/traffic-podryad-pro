import { describe, expect, test } from 'bun:test'
import { decideRotationOutcome } from './rotation'

const now = new Date('2026-08-14T12:00:00.000Z')
const raceWindowMs = 30_000

describe('decideRotationOutcome', () => {
  test('the current token rotates normally', () => {
    expect(
      decideRotationOutcome({ matched: 'current', rotatedAt: now, now, raceWindowMs }),
    ).toBe('rotate')
  })

  test('a previous token inside the race window is an idempotent reuse', () => {
    const rotatedAt = new Date(now.getTime() - raceWindowMs)
    expect(
      decideRotationOutcome({ matched: 'previous', rotatedAt, now, raceWindowMs }),
    ).toBe('reuse_within_window')
  })

  test('a previous token exactly on the window edge is still a reuse', () => {
    const rotatedAt = new Date(now.getTime() - raceWindowMs)
    expect(
      decideRotationOutcome({ matched: 'previous', rotatedAt, now, raceWindowMs }),
    ).toBe('reuse_within_window')
  })

  test('a previous token outside the window revokes the session', () => {
    const rotatedAt = new Date(now.getTime() - raceWindowMs - 1)
    expect(
      decideRotationOutcome({ matched: 'previous', rotatedAt, now, raceWindowMs }),
    ).toBe('revoke_session')
  })

  test('a previous token that was never rotated is treated as compromise', () => {
    expect(
      decideRotationOutcome({ matched: 'previous', rotatedAt: null, now, raceWindowMs }),
    ).toBe('revoke_session')
  })
})
