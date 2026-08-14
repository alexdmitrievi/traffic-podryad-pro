/**
 * The deterministic fake LLM driver.
 *
 * It never touches the network and returns fixed, marked content: this is what makes the
 * E2E scenario reproducible (docs/TESTING.md section 5). The fake's outline carries
 * `factsToVerify` markers, as the pipeline requires of any model output, and its usage is
 * zero cost — the fake exists for wiring, not for economics.
 */

import type {
  GenerateBriefInput,
  GenerateBriefOutput,
  GenerateDraftInput,
  GenerateDraftOutput,
  LlmPort,
  LlmResult,
} from './port'

const zeroUsage = { inputTokens: 0, outputTokens: 0, costMinorUnits: 0, costCurrency: 'RUB' }

export function createFakeLlmDriver(): LlmPort {
  return {
    async generateBrief(input: GenerateBriefInput): Promise<LlmResult<GenerateBriefOutput>> {
      return {
        content: {
          title: `Бриф: ${input.clusterTitle}`,
          outline: [
            {
              heading: 'О предмете',
              intent: 'informational',
              factsToVerify: ['Проверить характеристики у производителя.'],
            },
            {
              heading: 'Практические вопросы',
              intent: 'commercial',
              factsToVerify: ['Проверить условия поставки у коммерческого отдела.'],
            },
          ],
          audience: input.audience,
          tone: input.tone,
        },
        usage: { ...zeroUsage, inputTokens: 120, outputTokens: 340 },
      }
    },

    async generateDraft(input: GenerateDraftInput): Promise<LlmResult<GenerateDraftOutput>> {
      const sections = input.briefOutline
        .map((section) => `## ${section.heading}\n\nТекст раздела про ${section.heading.toLowerCase()}.`)
        .join('\n\n')

      return {
        content: {
          bodyMarkdown: `# ${input.briefTitle}\n\n${sections}`,
          metaTitle: input.briefTitle,
          metaDescription: `Материал по теме: ${input.clusterTitle}.`,
          factsToVerify: input.briefOutline.flatMap((section) => section.factsToVerify),
        },
        usage: { ...zeroUsage, inputTokens: 320, outputTokens: 900 },
      }
    },
  }
}
