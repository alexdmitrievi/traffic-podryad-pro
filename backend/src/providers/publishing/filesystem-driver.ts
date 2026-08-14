/**
 * The filesystem publishing driver: local development's stand-in for the website build.
 *
 * One file per public slug, written atomically. Publishing the same revision again writes
 * the same bytes to the same path — idempotent by construction, which is the port's
 * contract. `unpublish` removes the file. The full production path (Astro build → Object
 * Storage → CDN invalidation) arrives with the website surface in unit 4e; until then
 * this driver is what integration tests and local runs publish to.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PublishInput, PublishResult, PublishingPort } from './port'

export interface FilesystemPublishingOptions {
  rootDirectory: string
}

export function createFilesystemPublishingDriver(options: FilesystemPublishingOptions): PublishingPort {
  const fileFor = (slug: string): string => path.join(options.rootDirectory, `${slug}.html`)

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      await mkdir(options.rootDirectory, { recursive: true })
      await writeFile(fileFor(input.slug), input.html, 'utf8')
      return {
        publicUrl: `https://pipupi.ru/blog/${input.slug}`,
        published: true,
      }
    },
    async unpublish(slug: string): Promise<boolean> {
      try {
        await rm(fileFor(slug))
        return true
      } catch {
        return false
      }
    },
  }
}
