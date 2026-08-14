/**
 * The publishing port (docs/ARCHITECTURE.md section 4, docs/CONTENT_PIPELINE.md step 16).
 *
 * Publishing speaks in product terms: a content item, its public slug and the rendered
 * HTML of an approved revision. Only approved content reaches a driver — that gate lives
 * in the publishing module and is not the port's business. The port's own contract is
 * idempotency: publishing the same revision twice yields the same public state, never a
 * duplicate.
 */

export interface PublishInput {
  contentItemId: string
  revisionId: string
  slug: string
  /** The fully rendered public page. */
  html: string
  /** The source the website build re-renders from, and the site's SSG reads. */
  bodyMarkdown: string
  title: string
  description: string | null
}

export interface PublishResult {
  publicUrl: string
  published: boolean
}

export interface PublishingPort {
  publish(input: PublishInput): Promise<PublishResult>
  unpublish(slug: string): Promise<boolean>
}
