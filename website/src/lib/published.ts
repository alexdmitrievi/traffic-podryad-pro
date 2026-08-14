/**
 * The build-time data source: what the backend published.
 *
 * The publishing driver writes `slug.md` and `slug.meta.json` for every published
 * article. The Astro build reads them and generates one static page per slug — the
 * canonical article pages of pipupi.ru. When nothing is published, the article section
 * is simply empty: an honest empty state, not a demo page.
 *
 * The path is resolved from the working directory: `astro build` runs with the website
 * workspace as cwd, while `import.meta.url` gets remapped by the bundler during the
 * build and cannot be trusted here.
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const publishedDirectory = path.join(process.cwd(), '..', 'backend', '.storage', 'public')

export interface PublishedArticle {
  slug: string
  title: string
  description: string | null
  publishedAt: string
  bodyMarkdown: string
}

export async function listPublishedArticles(): Promise<PublishedArticle[]> {
  let entries: string[]
  try {
    entries = await readdir(publishedDirectory)
  } catch {
    return []
  }

  const slugs = entries
    .filter((name) => name.endsWith('.meta.json'))
    .map((name) => name.slice(0, -'.meta.json'.length))
    .sort()

  const articles: PublishedArticle[] = []
  for (const slug of slugs) {
    const meta = JSON.parse(
      await readFile(path.join(publishedDirectory, `${slug}.meta.json`), 'utf8'),
    ) as { slug: string; title: string; description: string | null; publishedAt: string }
    const bodyMarkdown = await readFile(
      path.join(publishedDirectory, `${slug}.md`),
      'utf8',
    )
    articles.push({ ...meta, bodyMarkdown })
  }
  return articles
}
