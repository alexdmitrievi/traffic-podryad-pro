/**
 * The LLM port — operations in product language, not provider calls
 * (docs/ARCHITECTURE.md section 4). The MVP has exactly two: a content brief and an
 * article draft. Nothing here names a provider, a model or an SDK.
 */

export interface BriefSectionInput {
  heading: string
  intent: string | null
}

export interface GenerateBriefInput {
  /** Normalized keyword phrases for the cluster. */
  keywords: string[]
  clusterTitle: string
  /** Product category names the cluster maps to. */
  productNames: string[]
  /** Region names the cluster maps to. */
  regionNames: string[]
  audience: string | null
  tone: string | null
  /** Editorial instructions for the model. */
  instructions: string[]
}

export interface BriefSectionOutput {
  heading: string
  intent: string | null
  /** Places the writer must verify against a source before publication. */
  factsToVerify: string[]
}

export interface GenerateBriefOutput {
  title: string
  outline: BriefSectionOutput[]
  audience: string | null
  tone: string | null
}

export interface GenerateDraftInput {
  /** The approved brief the draft is written from. */
  briefTitle: string
  briefOutline: BriefSectionOutput[]
  keywords: string[]
  clusterTitle: string
  productNames: string[]
  regionNames: string[]
  audience: string | null
  tone: string | null
}

export interface GenerateDraftOutput {
  bodyMarkdown: string
  metaTitle: string
  metaDescription: string
  /** Markers left by the model for facts a human must verify. */
  factsToVerify: string[]
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  /** Integer minor units (kopecks). Null when the provider did not report a cost. */
  costMinorUnits: number | null
  costCurrency: string | null
}

export interface LlmResult<T> {
  content: T
  usage: LlmUsage
}

export interface LlmPort {
  generateBrief(input: GenerateBriefInput): Promise<LlmResult<GenerateBriefOutput>>
  generateDraft(input: GenerateDraftInput): Promise<LlmResult<GenerateDraftOutput>>
}
