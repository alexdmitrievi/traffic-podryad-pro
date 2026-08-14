/**
 * The filesystem publishing driver: local development's stand-in for the website build.
 *
 * One publication writes three files per slug: the rendered `.html` (the assertable
 * output), the source `.md` and a `.meta.json` the Astro website reads at build time to
 * generate the public article page. Publishing the same revision again writes the same
 * bytes to the same paths — idempotent by construction, which is the port's contract.
 * `unpublish` removes all three. The full production path (Astro build → Object Storage →
 * CDN invalidation) arrives with the website surface; until then this driver is what
 * integration tests and local runs publish to.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PublishInput, PublishResult, PublishingPort } from './port'

export interface FilesystemPublishingOptions {
  rootDirectory: string
}

export function createFilesystemPublishingDriver(options: FilesystemPublishingOptions): PublishingPort {
  const fileFor = (slug: string, suffix: string): string =>
    path.join(options.rootDirectory, `${slug}${suffix}`)

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      await mkdir(options.rootDirectory, { recursive: true })
      await Promise.all([
        writeFile(fileFor(input.slug, '.html'), input.html, 'utf8'),
        writeFile(fileFor(input.slug, '.md'), input.bodyMarkdown, 'utf8'),
        writeFile(
          fileFor(input.slug, '.meta.json'),
          JSON.stringify(
            {
              slug: input.slug,
              title: input.title,
              description: input.description,
              publishedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
          'utf8',
        ),
      ])
      return {
        publicUrl: `https://pipupi.ru/blog/${input.slug}`,
        published: true,
      }
    },
    async unpublish(slug: string): Promise<boolean> {
      let removed = false
      for (const suffix of ['.html', '.md', '.meta.json']) {
        try {
          await rm(fileFor(slug, suffix))
          removed = true
        } catch {
          // A missing file is not an error: unpublish is honest about what remains.
        }
      }
      return removed
    },
  }
}
