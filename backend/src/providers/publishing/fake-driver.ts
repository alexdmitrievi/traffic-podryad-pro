/**
 * The in-memory fake publishing driver.
 *
 * Deterministic and inspection-friendly: it keeps every publish call in memory, which is
 * what the E2E scenario uses to assert "the right revision reached the site"
 * (docs/TESTING.md section 5). No network, no files, nothing survives a restart.
 */

import type { PublishInput, PublishResult, PublishingPort } from './port'

export interface FakePublishingDriver extends PublishingPort {
  published(): ReadonlyMap<string, PublishInput>
  calls(): number
}

export function createFakePublishingDriver(): FakePublishingDriver {
  const store = new Map<string, PublishInput>()
  let callCount = 0

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      callCount += 1
      store.set(input.slug, input)
      return {
        publicUrl: `https://pipupi.ru/blog/${input.slug}`,
        published: true,
      }
    },
    async unpublish(slug: string): Promise<boolean> {
      return store.delete(slug)
    },
    published() {
      return store
    },
    calls() {
      return callCount
    },
  }
}
