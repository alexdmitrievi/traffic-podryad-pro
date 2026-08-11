/**
 * Fixture tests for the architecture checker. architecture-check:fixtures
 *
 * This file carries the fixture marker because its job is to contain violating code —
 * including a dynamic import of a forbidden package, which the checker would otherwise
 * report against this file itself. The marker excludes it from the repository sweep only;
 * the fixtures below are still handed to the checker directly and must still be reported.
 *
 * Every rule is covered in both directions:
 *   - a violating fixture must be reported;
 *   - an allowed fixture must not be reported.
 *
 * The two directions together are what make the checker tamper-evident. A checker that
 * always returns [] fails the violating fixtures; a checker that flags everything fails
 * the allowed ones. The meta test at the bottom then asserts that every rule in RULES has
 * both kinds of fixture, so a rule cannot be deleted or silently disabled without a red test.
 */

import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FIXTURE_MARKER,
  RULES,
  checkArchitectureSources,
  checkManifests,
  extractImports,
  hasFixtureMarker,
  packageMatches,
} from './architecture-check.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))

/** @type {{rule: string, name: string, file: {path: string, source: string}}[]} */
const violatingFixtures = [
  {
    rule: 'AC-1-provider-sdk-boundary',
    name: 'product module imports an LLM SDK directly',
    file: {
      path: 'backend/src/modules/content/application/brief-service.ts',
      source: `import OpenAI from 'openai'\nexport const client = new OpenAI()\n`,
    },
  },
  {
    rule: 'AC-1-provider-sdk-boundary',
    name: 'product module imports an HTTP client',
    file: {
      path: 'backend/src/modules/research/infrastructure/keyword-repository.ts',
      source: `import axios from 'axios'\nexport const http = axios\n`,
    },
  },
  {
    rule: 'AC-1-direct-network-call',
    name: 'product module calls global fetch',
    file: {
      path: 'backend/src/modules/leads/application/lead-service.ts',
      source: `export async function push() {\n  return fetch('https://example.invalid')\n}\n`,
    },
  },
  {
    rule: 'AC-2-llm-personal-data-isolation',
    name: 'llm provider imports the leads module',
    file: {
      path: 'backend/src/providers/llm/deepseek.ts',
      source: `import { listLeads } from '../../modules/leads'\nexport const leads = listLeads\n`,
    },
  },
  {
    rule: 'AC-2-llm-personal-data-isolation',
    name: 'llm provider imports the attribution module through the workspace alias',
    file: {
      path: 'backend/src/providers/llm/prompt.ts',
      source: `import { touches } from '@/modules/attribution'\nexport const t = touches\n`,
    },
  },
  {
    rule: 'AC-3-forbidden-dependency',
    name: 'source imports a Telegram client',
    file: {
      path: 'backend/src/providers/messaging/telegram.ts',
      source: `import { Telegraf } from 'telegraf'\nexport const bot = Telegraf\n`,
    },
  },
  {
    rule: 'AC-3-forbidden-dependency',
    name: 'source imports MTProto',
    file: {
      path: 'scripts/invite-worker.mjs',
      source: `import { TelegramClient } from 'telegram'\nexport const c = TelegramClient\n`,
    },
  },
  {
    rule: 'AC-3-forbidden-dependency',
    name: 'source imports a mass-mail client',
    file: {
      path: 'backend/src/providers/mail/smtp.ts',
      source: `import nodemailer from 'nodemailer'\nexport const mail = nodemailer\n`,
    },
  },
  {
    rule: 'backend-layer-dependencies',
    name: 'transport imports Prisma',
    file: {
      path: 'backend/src/modules/content/transport/routes.ts',
      source: `import { PrismaClient } from '@prisma/client'\nexport const db = PrismaClient\n`,
    },
  },
  {
    rule: 'backend-layer-dependencies',
    name: 'application imports Hono',
    file: {
      path: 'backend/src/modules/content/application/content-service.ts',
      source: `import { Hono } from 'hono'\nexport const app = Hono\n`,
    },
  },
  {
    rule: 'backend-layer-dependencies',
    name: 'application imports environment configuration',
    file: {
      path: 'backend/src/modules/content/application/content-service.ts',
      source: `import { env } from '../../../env'\nexport const e = env\n`,
    },
  },
  {
    rule: 'backend-layer-dependencies',
    name: 'domain reaches outward into infrastructure',
    file: {
      path: 'backend/src/modules/content/domain/revision.ts',
      source: `import { repo } from '../infrastructure/content-repository'\nexport const r = repo\n`,
    },
  },
  {
    rule: 'backend-module-public-api',
    name: 'module reaches into another module internals',
    file: {
      path: 'backend/src/modules/publishing/application/publish-service.ts',
      source: `import { hash } from '../../approvals/domain/content-hash'\nexport const h = hash\n`,
    },
  },
  {
    rule: 'client-feature-public-api',
    name: 'feature reaches into another feature internals',
    file: {
      path: 'webapp/src/features/content/ContentPage.tsx',
      source: `import { queue } from '../approvals/api/queue'\nexport const q = queue\n`,
    },
  },
  {
    rule: 'client-dependency-direction',
    name: 'ui primitive imports a product feature',
    file: {
      path: 'webapp/src/components/ui/button.tsx',
      source: `import { useApprovals } from '../../features/approvals'\nexport const a = useApprovals\n`,
    },
  },
  {
    rule: 'contracts-dependency-direction',
    name: 'contracts import backend code',
    file: {
      path: 'packages/contracts/src/leads.ts',
      source: `import { leadRepository } from '@traffic/backend/modules/leads'\nexport const r = leadRepository\n`,
    },
  },
  {
    rule: 'contracts-dependency-direction',
    name: 'contracts import a framework',
    file: {
      path: 'packages/contracts/src/index.ts',
      source: `import { Hono } from 'hono'\nexport const app = Hono\n`,
    },
  },
]

/** @type {{rule: string, name: string, file: {path: string, source: string}}[]} */
const allowedFixtures = [
  {
    rule: 'AC-1-provider-sdk-boundary',
    name: 'provider layer may import its own SDK',
    file: {
      path: 'backend/src/providers/llm/deepseek.ts',
      source: `import OpenAI from 'openai'\nexport const client = new OpenAI()\n`,
    },
  },
  {
    rule: 'AC-1-provider-sdk-boundary',
    name: 'provider layer may import an HTTP client and the storage SDK',
    file: {
      path: 'backend/src/providers/storage/s3.ts',
      source: `import { S3Client } from '@aws-sdk/client-s3'\nimport axios from 'axios'\nexport const s3 = new S3Client({})\nexport const http = axios\n`,
    },
  },
  {
    rule: 'AC-1-direct-network-call',
    name: 'provider layer may call fetch, and a property named fetch is not a call',
    file: {
      path: 'backend/src/providers/llm/deepseek.ts',
      source: `export async function call(client) {\n  await client.fetch('/chat')\n  return fetch('https://api.deepseek.com')\n}\n`,
    },
  },
  {
    rule: 'AC-2-llm-personal-data-isolation',
    name: 'llm provider may import contracts and non-personal modules',
    file: {
      path: 'backend/src/providers/llm/deepseek.ts',
      source: `import { briefSchema } from '@traffic/contracts'\nimport { cluster } from '../../modules/research'\nexport const s = briefSchema\nexport const c = cluster\n`,
    },
  },
  {
    rule: 'AC-2-llm-personal-data-isolation',
    name: 'a non-llm provider is not covered by this rule',
    file: {
      path: 'backend/src/providers/publishing/internal-website.ts',
      source: `import { leadCount } from '../../modules/leads'\nexport const n = leadCount\n`,
    },
  },
  {
    rule: 'AC-3-forbidden-dependency',
    name: 'allowed packages with confusable names are not flagged',
    file: {
      path: 'backend/src/providers/storage/s3.ts',
      source: `import { S3Client } from '@aws-sdk/client-s3'\nimport { z } from 'zod'\nexport const s = S3Client\nexport const zz = z\n`,
    },
  },
  {
    rule: 'backend-layer-dependencies',
    name: 'application may import ports, domain and contracts',
    file: {
      path: 'backend/src/modules/content/application/content-service.ts',
      source: `import { revision } from '../domain/revision'\nimport type { LlmPort } from './ports'\nimport { briefSchema } from '@traffic/contracts'\nexport const r = revision\nexport const s = briefSchema\nexport type P = LlmPort\n`,
    },
  },
  {
    rule: 'backend-layer-dependencies',
    name: 'infrastructure may import Prisma',
    file: {
      path: 'backend/src/modules/content/infrastructure/content-repository.ts',
      source: `import { PrismaClient } from '@prisma/client'\nexport const db = PrismaClient\n`,
    },
  },
  {
    rule: 'backend-module-public-api',
    name: 'module may import another module public index',
    file: {
      path: 'backend/src/modules/publishing/application/publish-service.ts',
      source: `import { requireApproval } from '../../approvals'\nexport const a = requireApproval\n`,
    },
  },
  {
    rule: 'client-feature-public-api',
    name: 'feature may import its own internals and another feature public index',
    file: {
      path: 'webapp/src/features/content/ContentPage.tsx',
      source: `import { useDraft } from './api/draft'\nimport { useApprovals } from '../approvals'\nexport const d = useDraft\nexport const a = useApprovals\n`,
    },
  },
  {
    rule: 'client-dependency-direction',
    name: 'feature may import platform code and ui primitives',
    file: {
      path: 'webapp/src/features/content/ContentPage.tsx',
      source: `import { apiClient } from '../../platform/api'\nimport { Button } from '../../components/ui/button'\nexport const c = apiClient\nexport const B = Button\n`,
    },
  },
  {
    rule: 'contracts-dependency-direction',
    name: 'contracts may import zod and their own siblings',
    file: {
      path: 'packages/contracts/src/leads.ts',
      source: `import { z } from 'zod'\nimport { apiErrorSchema } from './errors'\nexport const s = z.object({ error: apiErrorSchema })\n`,
    },
  },
]

describe('violating fixtures are reported', () => {
  for (const fixture of violatingFixtures) {
    test(`${fixture.rule}: ${fixture.name}`, () => {
      const violations = checkArchitectureSources([fixture.file])
      const matched = violations.filter((violation) => violation.rule === fixture.rule)

      expect(matched.length).toBeGreaterThan(0)
      expect(matched[0].path).toBe(fixture.file.path)
      expect(matched[0].line).toBeGreaterThan(0)
      expect(matched[0].message.length).toBeGreaterThan(0)
    })
  }
})

describe('allowed fixtures are not reported', () => {
  for (const fixture of allowedFixtures) {
    test(`${fixture.rule}: ${fixture.name}`, () => {
      const violations = checkArchitectureSources([fixture.file])
      const matched = violations.filter((violation) => violation.rule === fixture.rule)

      expect(matched).toEqual([])
    })
  }
})

describe('AC-3 manifest scanning', () => {
  test('a forbidden dependency in any field is reported', () => {
    const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

    for (const field of fields) {
      const violations = checkManifests([
        { path: 'backend/package.json', manifest: { [field]: { telegraf: '^4.0.0' } } },
      ])

      expect(violations).toHaveLength(1)
      expect(violations[0].rule).toBe('AC-3-forbidden-dependency')
      expect(violations[0].message).toContain(field)
    }
  })

  test('scoped and prefixed forbidden packages are reported', () => {
    const violations = checkManifests([
      {
        path: 'package.json',
        manifest: {
          dependencies: {
            '@mtproto/core': '^1.0.0',
            '@maxhub/max-bot-api': '^0.2.2',
            '@aws-sdk/client-ses': '^3.0.0',
          },
        },
      },
    ])

    expect(violations).toHaveLength(3)
  })

  test('allowed dependencies pass, including the confusable aws storage client', () => {
    const violations = checkManifests([
      {
        path: 'backend/package.json',
        manifest: {
          dependencies: { hono: '^4.0.0', zod: '^4.0.0', '@aws-sdk/client-s3': '^3.0.0' },
          devDependencies: { typescript: '^6.0.0' },
        },
      },
    ])

    expect(violations).toEqual([])
  })

  test('a manifest without dependency fields is not an error', () => {
    expect(checkManifests([{ path: 'package.json', manifest: { name: 'x' } }])).toEqual([])
  })
})

describe('import extraction', () => {
  test('static, type-only, re-export, dynamic and require forms are all seen', () => {
    const source = [
      `import a from 'alpha'`,
      `import type { B } from 'beta'`,
      `export { c } from 'gamma'`,
      `const d = await import('delta')`,
      `const e = require('epsilon')`,
    ].join('\n')

    const specifiers = extractImports(source).map((entry) => entry.specifier)

    expect(specifiers).toContain('alpha')
    expect(specifiers).toContain('beta')
    expect(specifiers).toContain('gamma')
    expect(specifiers).toContain('delta')
    expect(specifiers).toContain('epsilon')
  })

  test('reported line numbers point at the import', () => {
    const source = `const x = 1\n\nimport y from 'yankee'\n`
    const found = extractImports(source).find((entry) => entry.specifier === 'yankee')

    expect(found?.line).toBe(3)
  })

  test('a dynamic import cannot smuggle a forbidden package past the checker', () => {
    const violations = checkArchitectureSources([
      {
        path: 'backend/src/modules/planning/application/plan-service.ts',
        source: `export async function send() {\n  const { Telegraf } = await import('telegraf')\n  return Telegraf\n}\n`,
      },
    ])

    expect(violations.some((violation) => violation.rule === 'AC-3-forbidden-dependency')).toBe(true)
  })
})

describe('package matching', () => {
  test('exact names and subpaths match, unrelated prefixes do not', () => {
    expect(packageMatches('telegram', 'telegram')).toBe(true)
    expect(packageMatches('telegram/sessions', 'telegram')).toBe(true)
    expect(packageMatches('telegram-utils', 'telegram')).toBe(false)
    expect(packageMatches('@mtproto/core', '@mtproto/')).toBe(true)
    expect(packageMatches('@aws-sdk/client-s3', '@aws-sdk/client-ses')).toBe(false)
  })
})

describe('checker integrity', () => {
  test('a clean repository produces no violations', () => {
    expect(checkArchitectureSources([])).toEqual([])
    expect(checkManifests([])).toEqual([])
  })

  test('violations are sorted by path, then line, then rule', () => {
    const violations = checkArchitectureSources([
      {
        path: 'backend/src/modules/content/transport/routes.ts',
        source: `import { PrismaClient } from '@prisma/client'\nimport axios from 'axios'\n`,
      },
      {
        path: 'backend/src/modules/approvals/application/approve.ts',
        source: `import { Hono } from 'hono'\n`,
      },
    ])

    const keys = violations.map((violation) => `${violation.path}:${violation.line}:${violation.rule}`)
    expect(keys).toEqual([...keys].sort())
  })

  /**
   * The tamper-evidence test. Deleting a rule, renaming it, or making its check a no-op
   * breaks this immediately, because every declared rule must still have a fixture that
   * fails and a fixture that passes.
   */
  test('every declared rule has both a violating and an allowed fixture', () => {
    const covered = new Set(violatingFixtures.map((fixture) => fixture.rule))
    const cleared = new Set(allowedFixtures.map((fixture) => fixture.rule))
    const manifestOnly = new Set(['AC-3-forbidden-dependency'])

    for (const rule of RULES) {
      expect(covered.has(rule)).toBe(true)
      if (!manifestOnly.has(rule)) {
        expect(cleared.has(rule)).toBe(true)
      }
    }
  })

  test('no fixture references a rule the checker does not declare', () => {
    for (const fixture of [...violatingFixtures, ...allowedFixtures]) {
      expect(RULES).toContain(fixture.rule)
    }
  })

  test('the rule registry is not empty', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(9)
  })
})

describe('fixture exemption', () => {
  test('this file carries the marker and the checker source does not', async () => {
    const own = await readFile(path.join(scriptsDirectory, 'architecture-check.test.mjs'), 'utf8')
    const checker = await readFile(path.join(scriptsDirectory, 'architecture-check.mjs'), 'utf8')

    expect(hasFixtureMarker(own)).toBe(true)
    expect(hasFixtureMarker(checker)).toBe(false)
  })

  test('the marker is only honoured near the top of the file', () => {
    expect(hasFixtureMarker(`// ${FIXTURE_MARKER}\ncode\n`)).toBe(true)
    expect(hasFixtureMarker(`${'\n'.repeat(60)}// ${FIXTURE_MARKER}\n`)).toBe(false)
  })

  /**
   * The exemption must not weaken the rules. A marked file is skipped only while sweeping
   * the repository; sources handed to the checker directly are still fully checked.
   */
  test('marked content passed directly is still reported', () => {
    const violations = checkArchitectureSources([
      {
        path: 'scripts/marked.test.mjs',
        source: `// ${FIXTURE_MARKER}\nimport { Telegraf } from 'telegraf'\n`,
      },
    ])

    expect(violations.some((violation) => violation.rule === 'AC-3-forbidden-dependency')).toBe(true)
  })
})
