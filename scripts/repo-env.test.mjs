/**
 * Fixture tests for the repository consistency checks.
 *
 * Same discipline as the architecture checker: for each rule, a broken repository must be
 * reported and a healthy one must not. `checkRepositoryState` takes its whole world as an
 * argument so these run against fixtures rather than the real tree.
 */

import { describe, expect, test } from 'bun:test'
import {
  checkRepositoryState,
  expectedPackageNames,
  fixtureExemptions,
  forbiddenEnvironmentKeys,
  parseEnvironmentTemplate,
  requiredEnvironmentValues,
} from './repo-env.mjs'

import { compareAgentDocuments } from './check-agent-docs.mjs'

/** The exact set of fixture markers a healthy repository carries. */
function expectedMarkers() {
  return Object.entries(fixtureExemptions).flatMap(([checker, paths]) =>
    paths.map((path) => ({ checker, path })),
  )
}

const healthyEnvironment = [
  'NODE_ENV=development',
  'AUTH_COOKIE_NAME=pip_rt',
  'AUTH_COOKIE_PATH=/',
  'REQUIRE_HUMAN_APPROVAL=true',
  'OUTBOUND_MESSAGING_ENABLED=false',
  'PII_TO_LLM_ALLOWED=false',
].join('\n')

const healthyCompose = [
  'services:',
  '  postgres:',
  '    image: postgres:18-alpine',
  '    ports:',
  '      - "127.0.0.1:${POSTGRES_PORT:-54329}:5432"',
].join('\n')

function healthyInput(overrides = {}) {
  return {
    rootManifest: {
      name: 'traffic-podryad-pro',
      packageManager: 'bun@1.3.11',
      workspaces: ['backend', 'webapp', 'website', 'packages/*'],
    },
    workspaceManifests: [
      { path: 'backend/package.json', manifest: { name: '@traffic/backend', scripts: { typecheck: 'echo x' } } },
      { path: 'webapp/package.json', manifest: { name: '@traffic/webapp', scripts: { typecheck: 'echo x' } } },
      { path: 'website/package.json', manifest: { name: '@traffic/website', scripts: { typecheck: 'echo x' } } },
      {
        path: 'packages/contracts/package.json',
        manifest: {
          name: '@traffic/contracts',
          scripts: { typecheck: 'echo x' },
          dependencies: { zod: '^4.4.3' },
          devDependencies: { typescript: '~7.0.2' },
        },
      },
    ],
    environmentTemplate: healthyEnvironment,
    composeFile: healthyCompose,
    documents: {
      LICENSE: 'Apache License Version 2.0',
      NOTICE: 'Vibe Coding Template\nCopyright 2026 Dima Sukharev',
      'docs/LOCAL_DATABASE.md': 'Порт разработки `54329` описан здесь.',
    },
    prismaSources: [],
    markedFiles: expectedMarkers(),
    bunVersionFile: '1.3.11\n',
    sourceFilesByWorkspace: { backend: 0, webapp: 0, website: 0, 'packages/contracts': 0 },
    ...overrides,
  }
}

function rulesFrom(problems) {
  return new Set(problems.map((problem) => problem.rule))
}

describe('a healthy repository passes', () => {
  test('no problems are reported', () => {
    expect(checkRepositoryState(healthyInput())).toEqual([])
  })
})

describe('compliance guards', () => {
  for (const [key, value] of Object.entries(requiredEnvironmentValues)) {
    test(`a missing ${key} is reported`, () => {
      const template = healthyEnvironment
        .split('\n')
        .filter((line) => !line.startsWith(`${key}=`))
        .join('\n')

      expect(rulesFrom(checkRepositoryState(healthyInput({ environmentTemplate: template })))).toContain(
        key === 'AUTH_COOKIE_PATH' ? 'compliance-guards' : 'compliance-guards',
      )
    })

    test(`a flipped ${key} is reported`, () => {
      const flipped = value === 'true' ? 'false' : value === 'false' ? 'true' : '/api/auth'
      const template = healthyEnvironment.replace(`${key}=${value}`, `${key}=${flipped}`)
      const problems = checkRepositoryState(healthyInput({ environmentTemplate: template }))

      expect(rulesFrom(problems)).toContain('compliance-guards')
      expect(problems.some((problem) => problem.message.includes(key))).toBe(true)
    })
  }
})

/**
 * Guards against a test suite that derives its own cases from the thing under test.
 *
 * A loop over `forbiddenEnvironmentKeys` generates zero cases when that list is emptied, so
 * deleting the rule would leave the suite green — the exact failure these tests exist to
 * prevent. Mutation testing found this hole; these assertions close it by pinning the
 * contents literally, so the lists cannot shrink without a red test.
 */
describe('rule registries are pinned literally', () => {
  test('forbidden environment keys are exactly the expected ones', () => {
    expect(forbiddenEnvironmentKeys).toEqual(['AUTH_COOKIE_DOMAIN'])
  })

  test('required environment values are exactly the expected ones', () => {
    expect(requiredEnvironmentValues).toEqual({
      REQUIRE_HUMAN_APPROVAL: 'true',
      OUTBOUND_MESSAGING_ENABLED: 'false',
      PII_TO_LLM_ALLOWED: 'false',
      AUTH_COOKIE_PATH: '/',
    })
  })

  test('AUTH_COOKIE_DOMAIN is rejected regardless of the registry contents', () => {
    // Written without reference to the list, so it survives the list being emptied.
    const template = `${healthyEnvironment}\nAUTH_COOKIE_DOMAIN=.pipupi.ru`
    const problems = checkRepositoryState(healthyInput({ environmentTemplate: template }))

    expect(problems.some((problem) => problem.message.includes('AUTH_COOKIE_DOMAIN'))).toBe(true)
  })

  test('each compliance guard is rejected when flipped, without reference to the registry', () => {
    const flips = [
      ['REQUIRE_HUMAN_APPROVAL=true', 'REQUIRE_HUMAN_APPROVAL=false'],
      ['OUTBOUND_MESSAGING_ENABLED=false', 'OUTBOUND_MESSAGING_ENABLED=true'],
      ['PII_TO_LLM_ALLOWED=false', 'PII_TO_LLM_ALLOWED=true'],
      ['AUTH_COOKIE_PATH=/', 'AUTH_COOKIE_PATH=/api/auth'],
    ]

    for (const [from, to] of flips) {
      const template = healthyEnvironment.replace(from, to)
      const problems = checkRepositoryState(healthyInput({ environmentTemplate: template }))

      expect(problems.length).toBeGreaterThan(0)
      expect(problems.some((problem) => problem.message.includes(to.split('=')[0]))).toBe(true)
    }
  })
})

describe('cookie policy', () => {
  for (const key of forbiddenEnvironmentKeys) {
    test(`${key} in the environment template is reported`, () => {
      const template = `${healthyEnvironment}\n${key}=.pipupi.ru`
      expect(rulesFrom(checkRepositoryState(healthyInput({ environmentTemplate: template })))).toContain('cookie-policy')
    })

    test(`${key} in docker-compose.yml is reported`, () => {
      const compose = `${healthyCompose}\n      ${key}: .pipupi.ru`
      expect(rulesFrom(checkRepositoryState(healthyInput({ composeFile: compose })))).toContain('cookie-policy')
    })
  }

  test('AUTH_COOKIE_PATH other than "/" is reported', () => {
    const template = healthyEnvironment.replace('AUTH_COOKIE_PATH=/', 'AUTH_COOKIE_PATH=/api/auth')
    expect(rulesFrom(checkRepositoryState(healthyInput({ environmentTemplate: template })))).toContain('compliance-guards')
  })
})

describe('vector gate', () => {
  const cases = [
    { name: 'a vector column', source: 'model Cluster {\n  embedding Unsupported("vector(1536)")\n}' },
    { name: 'an hnsw index', source: 'CREATE INDEX ON clusters USING hnsw (embedding vector_cosine_ops);' },
    { name: 'an ivfflat index', source: 'CREATE INDEX ON clusters USING ivfflat (embedding);' },
    { name: 'creating the extension', source: 'CREATE EXTENSION IF NOT EXISTS vector;' },
  ]

  for (const item of cases) {
    test(`${item.name} is reported while the gate is unresolved`, () => {
      const problems = checkRepositoryState(
        healthyInput({ prismaSources: [{ path: 'backend/prisma/schema.prisma', source: item.source }] }),
      )
      expect(rulesFrom(problems)).toContain('vector-gate')
    })
  }

  test('switching the local image to pgvector is reported', () => {
    const compose = healthyCompose.replace('postgres:18-alpine', 'pgvector/pgvector:pg18')
    expect(rulesFrom(checkRepositoryState(healthyInput({ composeFile: compose })))).toContain('vector-gate')
  })

  test('a schema without vectors passes', () => {
    const problems = checkRepositoryState(
      healthyInput({ prismaSources: [{ path: 'backend/prisma/schema.prisma', source: 'model Lead {\n  id String @id\n}' }] }),
    )
    expect(problems).toEqual([])
  })
})

describe('workspace layout and scope', () => {
  test('a missing workspace declaration is reported', () => {
    const problems = checkRepositoryState(
      healthyInput({ rootManifest: { packageManager: 'bun@1.3.11', workspaces: ['backend'] } }),
    )
    expect(rulesFrom(problems)).toContain('workspaces')
  })

  test('a package outside the @traffic scope is reported', () => {
    const manifests = healthyInput().workspaceManifests.map((entry) =>
      entry.path === 'backend/package.json'
        ? { ...entry, manifest: { ...entry.manifest, name: '@web-app-demo/backend' } }
        : entry,
    )
    expect(rulesFrom(checkRepositoryState(healthyInput({ workspaceManifests: manifests })))).toContain('package-scope')
  })

  test('every expected package name is required', () => {
    expect(expectedPackageNames).toHaveLength(4)
    for (const name of expectedPackageNames) expect(name.startsWith('@traffic/')).toBe(true)
  })
})

describe('runtime pin', () => {
  test('a mismatch between .bun-version and packageManager is reported', () => {
    expect(rulesFrom(checkRepositoryState(healthyInput({ bunVersionFile: '1.2.0\n' })))).toContain('bun-version')
  })

  test('a missing packageManager pin is reported', () => {
    const problems = checkRepositoryState(
      healthyInput({ rootManifest: { workspaces: ['backend', 'webapp', 'website', 'packages/*'] } }),
    )
    expect(rulesFrom(problems)).toContain('bun-version')
  })
})

describe('upstream rename', () => {
  for (const identifier of ['web-app-demo', 'web_app_demo', 'vibecoding-template']) {
    test(`a leftover "${identifier}" in a document is reported`, () => {
      const documents = { ...healthyInput().documents, 'docs/ARCHITECTURE.md': `uses ${identifier} still` }
      expect(rulesFrom(checkRepositoryState(healthyInput({ documents })))).toContain('rename')
    })
  }

  test('the Vibe attribution in NOTICE is not treated as a leftover', () => {
    expect(checkRepositoryState(healthyInput())).toEqual([])
  })
})

describe('licence and attribution', () => {
  test('a non-Apache LICENSE is reported', () => {
    const documents = { ...healthyInput().documents, LICENSE: 'MIT License' }
    expect(rulesFrom(checkRepositoryState(healthyInput({ documents })))).toContain('licence')
  })

  test('a NOTICE without upstream attribution is reported', () => {
    const documents = { ...healthyInput().documents, NOTICE: 'Pipupi only' }
    expect(rulesFrom(checkRepositoryState(healthyInput({ documents })))).toContain('licence')
  })
})

describe('local database', () => {
  test('a compose port that drifts from the documented one is reported', () => {
    const compose = healthyCompose.replace('54329', '55555')
    expect(rulesFrom(checkRepositoryState(healthyInput({ composeFile: compose })))).toContain('local-database')
  })

  test('a port published on all interfaces is reported', () => {
    const compose = healthyCompose.replace('127.0.0.1:', '')
    expect(rulesFrom(checkRepositoryState(healthyInput({ composeFile: compose })))).toContain('local-database')
  })
})

describe('fixture exemptions', () => {
  test('an unexpected marked file is reported', () => {
    const marked = [...expectedMarkers(), { checker: 'secret-scan', path: 'backend/src/config.ts' }]
    expect(rulesFrom(checkRepositoryState(healthyInput({ markedFiles: marked })))).toContain('fixture-exemption')
  })

  test('an allowlisted file that lost its marker is reported', () => {
    const marked = expectedMarkers().filter((entry) => entry.checker !== 'architecture-check')
    expect(rulesFrom(checkRepositoryState(healthyInput({ markedFiles: marked })))).toContain('fixture-exemption')
  })

  test('a marker attributed to the wrong checker is reported', () => {
    const marked = expectedMarkers().map((entry) => ({ ...entry, checker: 'secret-scan' }))
    expect(rulesFrom(checkRepositoryState(healthyInput({ markedFiles: marked })))).toContain('fixture-exemption')
  })

  test('both checkers are covered by the allowlist', () => {
    expect(Object.keys(fixtureExemptions).sort()).toEqual(['architecture-check', 'secret-scan'])
  })
})

describe('placeholder scripts', () => {
  test('a placeholder typecheck is allowed while the workspace has no sources', () => {
    expect(checkRepositoryState(healthyInput())).toEqual([])
  })

  test('a placeholder typecheck is reported once the workspace has sources', () => {
    const problems = checkRepositoryState(
      healthyInput({ sourceFilesByWorkspace: { backend: 12, webapp: 0, website: 0, 'packages/contracts': 0 } }),
    )
    expect(rulesFrom(problems)).toContain('placeholder-scripts')
  })

  test('a real typecheck with sources passes', () => {
    const manifests = healthyInput().workspaceManifests.map((entry) =>
      entry.path === 'backend/package.json'
        ? { ...entry, manifest: { ...entry.manifest, scripts: { typecheck: 'tsc --noEmit' } } }
        : entry,
    )
    const problems = checkRepositoryState(
      healthyInput({
        workspaceManifests: manifests,
        sourceFilesByWorkspace: { backend: 12, webapp: 0, website: 0, 'packages/contracts': 0 },
      }),
    )
    expect(problems).toEqual([])
  })
})

describe('contracts stay the source of truth', () => {
  function withContractsManifest(manifest) {
    return healthyInput().workspaceManifests.map((entry) =>
      entry.path === 'packages/contracts/package.json' ? { ...entry, manifest } : entry,
    )
  }

  test('contracts without zod are reported', () => {
    const manifests = withContractsManifest({
      name: '@traffic/contracts',
      scripts: { typecheck: 'echo x' },
    })

    expect(rulesFrom(checkRepositoryState(healthyInput({ workspaceManifests: manifests })))).toContain(
      'contracts',
    )
  })

  test('a framework or provider dependency in contracts is reported', () => {
    for (const dependency of ['hono', 'react', '@prisma/client', 'openai']) {
      const manifests = withContractsManifest({
        name: '@traffic/contracts',
        scripts: { typecheck: 'echo x' },
        dependencies: { zod: '^4.4.3', [dependency]: '^1.0.0' },
      })

      const problems = checkRepositoryState(healthyInput({ workspaceManifests: manifests }))
      expect(rulesFrom(problems)).toContain('contracts')
      expect(problems.some((problem) => problem.message.includes(dependency))).toBe(true)
    }
  })

  test('typescript as a devDependency is fine', () => {
    expect(checkRepositoryState(healthyInput())).toEqual([])
  })
})

describe('the catalog stays generic', () => {
  const niches = ['petroleum', 'нефтепродукт', 'diesel', 'дизель', 'бензин', 'мазут']

  for (const term of niches) {
    test(`a niche name "${term}" declared in the schema is reported`, () => {
      const problems = checkRepositoryState(
        healthyInput({
          prismaSources: [
            {
              path: 'backend/prisma/schema.prisma',
              source: `model ${term}Product {\n  id String @id\n}`,
            },
          ],
        }),
      )

      expect(rulesFrom(problems)).toContain('catalog-genericity')
    })
  }

  test('a niche named in a comment is not a violation', () => {
    // The schema explains that petroleum is the first workspace. Explaining the rule must
    // not trip it — only a declaration does.
    const problems = checkRepositoryState(
      healthyInput({
        prismaSources: [
          {
            path: 'backend/prisma/schema.prisma',
            source: '// Petroleum wholesale is the first vertical, a row in verticals.\nmodel Vertical {\n  id String @id\n}',
          },
        ],
      }),
    )

    expect(problems).toEqual([])
  })

  test('a generic catalog schema passes', () => {
    const problems = checkRepositoryState(
      healthyInput({
        prismaSources: [
          {
            path: 'backend/prisma/schema.prisma',
            source: 'model Vertical {\n  id String @id\n  code String\n}\n\nmodel Product {\n  id String @id\n}',
          },
        ],
      }),
    )

    expect(problems).toEqual([])
  })
})

describe('environment template parsing', () => {
  test('comments and blank lines are ignored, values keep their content', () => {
    const values = parseEnvironmentTemplate('# comment\n\nA=1\nB = two \n#C=3\nD=\n')

    expect(values.get('A')).toBe('1')
    expect(values.get('B')).toBe('two')
    expect(values.has('C')).toBe(false)
    expect(values.get('D')).toBe('')
  })
})

describe('agent document comparison', () => {
  const encode = (text) => new Uint8Array(new TextEncoder().encode(text))

  test('identical documents pass', () => {
    const bytes = encode('# Agent Instructions\n')
    const result = compareAgentDocuments([
      { path: 'CLAUDE.md', bytes },
      { path: 'AGENTS.md', bytes },
    ])

    expect(result.ok).toBe(true)
  })

  test('a length difference is reported', () => {
    const result = compareAgentDocuments([
      { path: 'CLAUDE.md', bytes: encode('one') },
      { path: 'AGENTS.md', bytes: encode('one more') },
    ])

    expect(result.ok).toBe(false)
  })

  test('a single differing byte is reported with a line number', () => {
    const result = compareAgentDocuments([
      { path: 'CLAUDE.md', bytes: encode('line one\nline two\n') },
      { path: 'AGENTS.md', bytes: encode('line one\nline TWO\n') },
    ])

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('line 2')
  })

  test('whitespace-only drift still fails', () => {
    const result = compareAgentDocuments([
      { path: 'CLAUDE.md', bytes: encode('a\n') },
      { path: 'AGENTS.md', bytes: encode('a \n') },
    ])

    expect(result.ok).toBe(false)
  })
})
