/**
 * The PII runtime guard for the LLM port (docs/COMPLIANCE.md section 4, WAVE_4_DELEGATION
 * section 4c).
 *
 * Rule AC-2 catches imports statically; this guard catches the transmission itself. The
 * model receives keywords, brief structure and article text — nothing else — and every
 * payload passes through here before any driver is reached. The guard scans the
 * serialized input rather than individual fields, so a phone number smuggled through an
 * "editorial instruction" string is caught the same way as one in a dedicated field.
 *
 * `PII_TO_LLM_ALLOWED=false` is enforced at process start; the guard makes the runtime
 * consequence of that fuse concrete instead of declarative.
 */

import type {
  GenerateBriefInput,
  GenerateDraftInput,
  LlmPort,
} from './port'

export class LlmGuardError extends Error {
  constructor(
    message: string,
    public readonly patterns: string[],
  ) {
    super(message)
    this.name = 'LlmGuardError'
  }
}

export interface PiiPattern {
  id: string
  pattern: RegExp
}

export const piiPatterns: PiiPattern[] = [
  {
    id: 'email',
    // Something@something.something — the shape the lead form collects.
    pattern: /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/,
  },
  {
    id: 'phone',
    // Russian phone forms: +7/8 with optional separators.
    pattern: /(?:\+7|8)\s*\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/,
  },
  {
    id: 'inn',
    // INN is 10 or 12 digits; a long digit run in an LLM payload has no legitimate shape.
    pattern: /\b\d{10}\b|\b\d{12}\b/,
  },
]

export function findPii(input: GenerateBriefInput | GenerateDraftInput): string[] {
  const serialized = JSON.stringify(input)
  return piiPatterns
    .filter((entry) => entry.pattern.test(serialized))
    .map((entry) => entry.id)
}

export function createGuardedLlmPort<T extends LlmPort>(inner: T): T {
  const guard = (input: GenerateBriefInput | GenerateDraftInput): void => {
    const patterns = findPii(input)
    if (patterns.length > 0) {
      throw new LlmGuardError(
        `LLM payload contains personal-data patterns (${patterns.join(', ')}); the model receives keywords, brief structure and article text only`,
        patterns,
      )
    }
  }

  // The cast preserves the inner port's exact result type (an instrumented port carries
  // the llm_runs id); the wrapper only adds the refusal check and changes no shape.
  return {
    async generateBrief(input: GenerateBriefInput) {
      guard(input)
      return inner.generateBrief(input)
    },
    async generateDraft(input: GenerateDraftInput) {
      guard(input)
      return inner.generateDraft(input)
    },
  } as T
}
