/**
 * The one contract suite for the publishing port, run against every driver.
 */

import { describe, expect, test } from 'bun:test'
import type { PublishingPort } from './port'

const input = {
  contentItemId: '0192f1a0-0000-7000-8000-000000000001',
  revisionId: '0192f1a0-0000-7000-8000-000000000002',
  slug: 'dt-optom-omsk',
  html: '<html><body>Статья</body></html>',
}

export function runPublishingContractSuite(createDriver: () => PublishingPort): void {
  const driver = () => createDriver()

  describe('PublishingPort contract', () => {
    test('publish returns a public URL', async () => {
      const result = await driver().publish(input)

      expect(result.publicUrl).toContain(input.slug)
      expect(result.published).toBe(true)
    })

    test('publishing the same revision twice is idempotent', async () => {
      const first = await driver().publish(input)
      const second = await driver().publish(input)

      expect(second.publicUrl).toBe(first.publicUrl)
    })

    test('unpublish removes a published slug and is honest about a missing one', async () => {
      // One driver instance: this test exercises state transitions on a single store.
      const single = createDriver()
      await single.publish(input)

      expect(await single.unpublish(input.slug)).toBe(true)
      expect(await single.unpublish(input.slug)).toBe(false)
    })
  })
}
