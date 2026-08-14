/**
 * Repository consistency checks for Pipupi.
 *
 * These guard the decisions that live in more than one file at once. Every rule here exists
 * because the two copies of a value can drift apart silently, and the drift is only noticed
 * when something breaks in production or when a compliance guard turns out to be off.
 *
 * Dependency-free, like the other repository checks.
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Compliance guards that must hold their MVP values in the tracked environment template. */
export const requiredEnvironmentValues = {
  REQUIRE_HUMAN_APPROVAL: 'true',
  OUTBOUND_MESSAGING_ENABLED: 'false',
  PII_TO_LLM_ALLOWED: 'false',
  AUTH_COOKIE_PATH: '/',
}

/**
 * Variables that must not exist at all. `AUTH_COOKIE_DOMAIN` is the security model: the
 * authentication cookie is host-only for api.pipupi.ru, and the absence of this variable is
 * what implements that. Adding it would hand the session cookie to the public website.
 */
export const forbiddenEnvironmentKeys = ['AUTH_COOKIE_DOMAIN']

/** Identifiers inherited from the upstream template that must not survive the rename. */
export const forbiddenIdentifiers = ['web-app-demo', 'web_app_demo', 'vibecoding-template']

/**
 * Files allowed to carry a checker's fixture marker, per checker.
 *
 * Both checkers skip marked files while sweeping the repository. That skip is the one hole
 * in each of them, so the set of marked files is pinned here: adding an exemption takes a
 * second, deliberate change in a different file from the one being excused.
 */
export const fixtureExemptions = {
  'secret-scan': [
    'scripts/check-secrets.test.mjs',
    // The auth integration suite presents fake passwords to the login endpoint by design.
    'backend/tests/integration/auth.integration.test.ts',
    // The E2E scenario signs in with a fake admin credential by design.
    'webapp/e2e/pipeline.spec.ts',
  ],
  'architecture-check': ['scripts/architecture-check.test.mjs'],
}

/** Kept for readability at the call sites and in tests. */
export const secretScanExemptions = fixtureExemptions['secret-scan']

export const expectedWorkspaces = ['backend', 'webapp', 'website', 'packages/*']
export const expectedPackageNames = [
  '@traffic/backend',
  '@traffic/webapp',
  '@traffic/website',
  '@traffic/contracts',
]

export function parseEnvironmentTemplate(source) {
  const values = new Map()
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator === -1) continue
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return values
}

/**
 * @param {object} input
 * @returns {{rule: string, message: string}[]}
 */
export function checkRepositoryState(input) {
  const problems = []
  const fail = (rule, message) => problems.push({ rule, message })

  const {
    rootManifest = {},
    workspaceManifests = [],
    environmentTemplate = '',
    composeFile = '',
    documents = {},
    prismaSources = [],
    markedFiles = [],
    bunVersionFile = '',
    sourceFilesByWorkspace = {},
  } = input

  // ── Workspace layout ──────────────────────────────────────────────────────
  const declaredWorkspaces = rootManifest.workspaces ?? []
  for (const expected of expectedWorkspaces) {
    if (!declaredWorkspaces.includes(expected)) {
      fail('workspaces', `root package.json must declare workspace "${expected}"`)
    }
  }

  const foundNames = workspaceManifests.map((entry) => entry.manifest?.name)
  for (const expected of expectedPackageNames) {
    if (!foundNames.includes(expected)) {
      fail('package-scope', `workspace package "${expected}" is missing`)
    }
  }
  for (const entry of workspaceManifests) {
    const name = entry.manifest?.name
    if (name && !name.startsWith('@traffic/')) {
      fail('package-scope', `${entry.path} declares "${name}"; workspace packages use the @traffic/* scope`)
    }
  }

  // ── Runtime pin ───────────────────────────────────────────────────────────
  const pinnedManager = String(rootManifest.packageManager ?? '')
  const pinnedVersion = pinnedManager.startsWith('bun@') ? pinnedManager.slice(4) : ''
  const bunVersion = bunVersionFile.trim()
  if (!pinnedVersion) {
    fail('bun-version', 'root package.json must pin packageManager to a bun@<version>')
  } else if (bunVersion && bunVersion !== pinnedVersion) {
    fail('bun-version', `.bun-version is ${bunVersion} but package.json pins bun@${pinnedVersion}`)
  }

  // ── Environment template ──────────────────────────────────────────────────
  const environment = parseEnvironmentTemplate(environmentTemplate)
  for (const [key, expected] of Object.entries(requiredEnvironmentValues)) {
    if (!environment.has(key)) {
      fail('compliance-guards', `backend/.env.example must define ${key}`)
    } else if (environment.get(key) !== expected) {
      fail(
        'compliance-guards',
        `backend/.env.example sets ${key}=${environment.get(key)}; the MVP requires ${key}=${expected}`,
      )
    }
  }

  for (const key of forbiddenEnvironmentKeys) {
    if (environment.has(key)) {
      fail(
        'cookie-policy',
        `${key} must not exist: the authentication cookie is host-only for api.pipupi.ru, and its absence is what implements that`,
      )
    }
    if (composeFile.includes(key)) {
      fail('cookie-policy', `${key} must not appear in docker-compose.yml`)
    }
  }

  // ── Local database ports match the documented ones ────────────────────────
  const documentedPort = documents['docs/LOCAL_DATABASE.md']?.match(/`(\d{4,5})`/)?.[1]
  if (documentedPort && !composeFile.includes(`:-${documentedPort}}`)) {
    fail(
      'local-database',
      `docs/LOCAL_DATABASE.md documents port ${documentedPort} but docker-compose.yml does not default to it`,
    )
  }
  if (composeFile && !composeFile.includes('postgres:18-alpine')) {
    fail('local-database', 'docker-compose.yml must use postgres:18-alpine for local development')
  }
  if (composeFile && !/127\.0\.0\.1:/.test(composeFile)) {
    fail('local-database', 'docker-compose.yml must bind published ports to 127.0.0.1 only')
  }

  // ── Production vector gate is still unresolved ────────────────────────────
  // Vector columns and indexes must not exist until the gate in docs/DEPLOYMENT.md is
  // passed against a real managed cluster. Shipping them earlier means the first migration
  // to reach production fails on a missing extension, after the rest of the schema landed.
  for (const entry of prismaSources) {
    if (/\bvector\s*\(|USING\s+(?:hnsw|ivfflat)|CREATE\s+EXTENSION[^;]*vector/i.test(entry.source)) {
      fail(
        'vector-gate',
        `${entry.path} declares a vector column or index while the production pgvector gate is unresolved (docs/DEPLOYMENT.md section 3)`,
      )
    }
  }
  if (composeFile.includes('pgvector/pgvector')) {
    fail(
      'vector-gate',
      'docker-compose.yml switches to a pgvector image while the production gate is unresolved; decide the local image in Wave 3',
    )
  }

  // ── Upstream template identifiers are gone ────────────────────────────────
  for (const [documentPath, source] of Object.entries(documents)) {
    for (const identifier of forbiddenIdentifiers) {
      if (source.includes(identifier)) {
        fail('rename', `${documentPath} still contains the upstream identifier "${identifier}"`)
      }
    }
  }
  for (const identifier of forbiddenIdentifiers) {
    if (JSON.stringify(rootManifest).includes(identifier)) {
      fail('rename', `root package.json still contains the upstream identifier "${identifier}"`)
    }
  }

  // ── Licence and attribution survive ───────────────────────────────────────
  if (!documents['LICENSE']?.includes('Apache License')) {
    fail('licence', 'LICENSE must remain the Apache-2.0 text')
  }
  if (!documents['NOTICE']?.includes('Vibe Coding Template')) {
    fail('licence', 'NOTICE must keep the upstream Vibe Coding Template attribution')
  }

  // ── Checker exemptions are exactly the expected ones ──────────────────────
  // markedFiles is [{ checker, path }]. Both directions are checked: an unexpected marker
  // is a hole nobody approved, and a missing one means a checker silently started scanning
  // a fixture file, which turns the build red for the wrong reason.
  for (const [checker, allowed] of Object.entries(fixtureExemptions)) {
    const marked = markedFiles
      .filter((entry) => entry.checker === checker)
      .map((entry) => entry.path)

    for (const file of marked) {
      if (!allowed.includes(file)) {
        fail(
          'fixture-exemption',
          `${file} carries the ${checker} fixture marker but is not in the expected allowlist`,
        )
      }
    }
    for (const expected of allowed) {
      if (!marked.includes(expected)) {
        fail(
          'fixture-exemption',
          `${expected} is allowlisted for ${checker} but no longer carries the marker`,
        )
      }
    }
  }

  // ── Contracts are the source of truth and stay dependency-light ───────────
  const contractsManifest = workspaceManifests.find(
    (entry) => entry.manifest?.name === '@traffic/contracts',
  )?.manifest
  if (contractsManifest) {
    const runtimeDependencies = Object.keys(contractsManifest.dependencies ?? {})
    if (!runtimeDependencies.includes('zod')) {
      fail('contracts', '@traffic/contracts must depend on zod: the schemas are the contract')
    }
    for (const dependency of runtimeDependencies) {
      if (dependency !== 'zod') {
        fail(
          'contracts',
          `@traffic/contracts declares runtime dependency "${dependency}"; contracts carry schemas, not frameworks, persistence or provider SDKs`,
        )
      }
    }
  }

  // ── The catalog stays a module, not a hardcoded niche ─────────────────────
  // Petroleum is the first workspace, not the product's specialisation. If a niche name
  // reaches the schema or the contracts, the second vertical becomes a migration.
  const nicheTerms = ['petroleum', 'нефтепродукт', 'diesel', 'дизель', 'benzin', 'бензин', 'mazut', 'мазут']
  for (const entry of prismaSources) {
    const declarations = entry.source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
      .toLowerCase()

    for (const term of nicheTerms) {
      if (declarations.includes(term)) {
        fail(
          'catalog-genericity',
          `${entry.path} names the niche "${term}" in a declaration; the catalog is generic and petroleum belongs in seed data`,
        )
      }
    }
  }

  // ── Placeholder scripts must not outlive their workspace's sources ────────
  // A `typecheck` that echoes is honest while a workspace has no TypeScript. The moment it
  // has some, an echoing typecheck is a green check that verifies nothing.
  for (const entry of workspaceManifests) {
    const workspace = entry.path.replace(/\/package\.json$/, '')
    const hasSources = (sourceFilesByWorkspace[workspace] ?? 0) > 0
    const typecheck = String(entry.manifest?.scripts?.typecheck ?? '')
    if (hasSources && typecheck.startsWith('echo')) {
      fail(
        'placeholder-scripts',
        `${entry.path} has TypeScript sources but its typecheck script is still a placeholder`,
      )
    }
  }

  return problems
}

async function readIfPresent(relativePath) {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}

async function collectFiles(directory, predicate) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const files = []
  for (const entry of entries) {
    // `generated` holds the Prisma client, which is git-ignored build output. Counting it as
    // workspace source would make the placeholder-script rule fire on a backend that still
    // has no hand-written TypeScript.
    if (['node_modules', '.git', 'generated', 'dist', 'build'].includes(entry.name)) continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath, predicate)))
    else if (predicate(entry.name)) files.push(entryPath)
  }
  return files
}

async function main() {
  const rootManifest = JSON.parse(await readIfPresent('package.json') || '{}')

  const workspaceManifests = []
  for (const workspace of ['backend', 'webapp', 'website', 'packages/contracts']) {
    const source = await readIfPresent(`${workspace}/package.json`)
    if (source) {
      workspaceManifests.push({ path: `${workspace}/package.json`, manifest: JSON.parse(source) })
    }
  }

  const documents = {}
  for (const name of ['LICENSE', 'NOTICE', 'README.md', 'CLAUDE.md', 'AGENTS.md', 'CHECKLIST.md']) {
    documents[name] = await readIfPresent(name)
  }
  for (const filePath of await collectFiles(path.join(repositoryRoot, 'docs'), (name) => name.endsWith('.md'))) {
    documents[path.relative(repositoryRoot, filePath).replaceAll(path.sep, '/')] = await readFile(filePath, 'utf8')
  }

  const prismaSources = []
  for (const filePath of await collectFiles(repositoryRoot, (name) => name.endsWith('.prisma') || name.endsWith('.sql'))) {
    prismaSources.push({
      path: path.relative(repositoryRoot, filePath).replaceAll(path.sep, '/'),
      source: await readFile(filePath, 'utf8'),
    })
  }

  const secretScan = await import('./check-secrets.mjs')
  const architectureCheck = await import('./architecture-check.mjs')
  const markerReaders = [
    { checker: 'secret-scan', hasMarker: secretScan.hasFixtureMarker },
    { checker: 'architecture-check', hasMarker: architectureCheck.hasFixtureMarker },
  ]

  const markedFiles = []
  for (const filePath of await collectFiles(repositoryRoot, (name) =>
    /\.(?:[cm]?[jt]sx?|md|ya?ml|json|example)$/.test(name),
  )) {
    const relative = path.relative(repositoryRoot, filePath).replaceAll(path.sep, '/')
    const source = await readFile(filePath, 'utf8')
    for (const { checker, hasMarker } of markerReaders) {
      if (hasMarker(source)) markedFiles.push({ checker, path: relative })
    }
  }

  const sourceFilesByWorkspace = {}
  for (const workspace of ['backend', 'webapp', 'website', 'packages/contracts']) {
    const files = await collectFiles(path.join(repositoryRoot, workspace, 'src'), (name) =>
      /\.(?:[cm]?tsx?)$/.test(name),
    )
    sourceFilesByWorkspace[workspace] = files.length
  }

  const problems = checkRepositoryState({
    rootManifest,
    workspaceManifests,
    environmentTemplate: await readIfPresent('backend/.env.example'),
    composeFile: await readIfPresent('docker-compose.yml'),
    documents,
    prismaSources,
    markedFiles,
    bunVersionFile: await readIfPresent('.bun-version'),
    sourceFilesByWorkspace,
  })

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`[${problem.rule}] ${problem.message}`)
    }
    console.error(`\nRepository consistency check failed with ${problems.length} problem(s).`)
    process.exitCode = 1
    return
  }

  console.log(
    `Repository consistency check passed: ${workspaceManifests.length} workspace(s), ${Object.keys(documents).length} document(s), ${prismaSources.length} schema file(s).`,
  )
}

if (import.meta.main) await main()
