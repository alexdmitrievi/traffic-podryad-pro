/**
 * Architecture boundary checker for Pipupi.
 *
 * Reports forbidden static imports as `path:line [rule] message` and exits non-zero.
 * Dependency-free on purpose: it must run before anything is installed, and it is the
 * one check that must never be blocked by a broken dependency tree.
 *
 * The three product rules are AC-1, AC-2 and AC-3 from CLAUDE.md section 4. The layer
 * and boundary rules below them come from docs/ARCHITECTURE.md.
 *
 * Every rule in RULES has fixture tests in architecture-check.test.mjs proving both
 * directions: a violating fixture must fail, and an allowed fixture must pass. A meta
 * test asserts that coverage, so the checker cannot be silently gutted.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Directories whose sources participate in import-boundary rules. */
export const sourceRoots = [
  'backend/src',
  'backend/prisma',
  'packages/contracts/src',
  'webapp/src',
  'website/src',
  'scripts',
]

/**
 * Directories skipped while walking. `generated` holds machine-written output — the Prisma
 * client is ~3 MB of it — which no human wrote and no boundary rule applies to.
 */
const skippedDirectories = new Set(['node_modules', 'generated', 'dist', 'build', 'coverage'])

/** Manifests scanned for forbidden dependency declarations (AC-3). */
export const manifestGlobRoots = ['.', 'backend', 'webapp', 'website', 'packages/contracts']

const sourceExtension = /\.(?:[cm]?[jt]sx?)$/
const importPattern =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
const runtimeModulePattern = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * AC-3. Packages that must not exist anywhere in this repository during the MVP.
 * Messaging transports, Telegram user-account automation, MTProto and mass-mail clients.
 * `@aws-sdk/client-ses` is listed while `@aws-sdk/client-s3` is not: object storage is a
 * supported capability, transactional mail is not.
 */
export const forbiddenPackages = [
  'telegram',
  'telegraf',
  'grammy',
  'gramjs',
  'node-telegram-bot-api',
  'telegram-mtproto',
  'mtproto-core',
  '@mtproto/',
  'airgram',
  '@maxhub/',
  'whatsapp-web.js',
  'vk-io',
  'nodemailer',
  '@sendgrid/',
  'mailgun.js',
  'mailgun-js',
  'postmark',
  'resend',
  '@aws-sdk/client-ses',
  'twilio',
  'n8n',
  'n8n-core',
  'n8n-workflow',
]

/**
 * AC-1. Provider SDKs and external HTTP clients. Allowed only under
 * `backend/src/providers/**`; a product module reaches the outside world through a port.
 */
export const providerOnlyPackages = [
  'openai',
  '@anthropic-ai/',
  '@google/generative-ai',
  '@mistralai/',
  'cohere-ai',
  '@aws-sdk/',
  'aws-sdk',
  '@google-cloud/',
  '@azure/',
  'minio',
  'axios',
  'got',
  'ky',
  'node-fetch',
  'undici',
  'superagent',
  'phin',
  'node:http',
  'node:https',
]

/** AC-2. Modules that own personal data and must stay invisible to the LLM provider layer. */
export const personalDataModules = ['leads', 'attribution']

/**
 * A file whose job is to contain violating code declares it with this marker near the top.
 *
 * Only the fixture file needs it. The exemption is inline rather than a path list here, so it
 * is visible in the file it excuses, and every run prints which files used it.
 * `scripts/repo-env.mjs` asserts the marked set against an expected allowlist, so a new
 * exemption takes a second, deliberate change.
 *
 * Note the skip happens while collecting files from disk, not inside
 * `checkArchitectureSources`. The fixture tests hand violating sources to that function
 * directly and must still get violations back.
 */
export const FIXTURE_MARKER = 'architecture-check:fixtures'
const MARKER_SCAN_LINES = 30

export function hasFixtureMarker(source) {
  return source.split('\n', MARKER_SCAN_LINES).join('\n').includes(FIXTURE_MARKER)
}

const applicationForbiddenPackages = ['@prisma/', 'hono', 'pg', 'jose', ...providerOnlyPackages]
const transportForbiddenPackages = ['@prisma/', 'pg', 'jose', ...providerOnlyPackages]
const contractForbiddenPackages = ['@prisma/', 'hono', 'react', 'react-dom', 'astro', 'pg', 'jose', ...providerOnlyPackages]

/** Registry of every rule this checker can report. The meta test walks it. */
export const RULES = [
  'AC-1-provider-sdk-boundary',
  'AC-1-direct-network-call',
  'AC-2-llm-personal-data-isolation',
  'AC-3-forbidden-dependency',
  'backend-layer-dependencies',
  'backend-module-public-api',
  'client-dependency-direction',
  'client-feature-public-api',
  'contracts-dependency-direction',
]

/**
 * @param {{path: string, source: string}[]} files
 * @returns {{path: string, line: number, rule: string, message: string}[]}
 */
export function checkArchitectureSources(files) {
  const violations = []

  for (const file of files) {
    const filePath = normalizePath(file.path)
    const report = (line, rule, message) => violations.push({ path: filePath, line, rule, message })

    for (const imported of extractImports(file.source)) {
      const emit = (rule, message) => report(imported.line, rule, message)
      checkForbiddenDependency(filePath, imported.specifier, emit)
      checkProviderSdkBoundary(filePath, imported.specifier, emit)
      checkLlmPersonalDataIsolation(filePath, imported.specifier, emit)
      checkBackendLayers(filePath, imported.specifier, emit)
      checkBackendModuleBoundary(filePath, imported.specifier, emit)
      checkClientBoundary(filePath, imported.specifier, emit)
      checkContracts(filePath, imported.specifier, emit)
    }

    checkDirectNetworkCalls(filePath, file.source, report)
  }

  return sortViolations(violations)
}

/**
 * AC-3 at the manifest level. An import check alone cannot see a dependency that was
 * added but not yet imported, and that is exactly the state a mistake arrives in.
 *
 * @param {{path: string, manifest: object}[]} manifests
 */
export function checkManifests(manifests) {
  const violations = []
  const dependencyFields = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]

  for (const entry of manifests) {
    for (const field of dependencyFields) {
      const declared = entry.manifest?.[field]
      if (!declared || typeof declared !== 'object') continue

      for (const name of Object.keys(declared)) {
        const forbidden = forbiddenPackages.find((candidate) => packageMatches(name, candidate))
        if (forbidden) {
          violations.push({
            path: normalizePath(entry.path),
            line: 1,
            rule: 'AC-3-forbidden-dependency',
            message: `${field} must not declare "${name}": messaging, Telegram automation, MTProto and mass-mail packages are forbidden in the MVP.`,
          })
        }
      }
    }
  }

  return sortViolations(violations)
}

function checkForbiddenDependency(filePath, specifier, report) {
  const forbidden = forbiddenPackages.find((candidate) => packageMatches(specifier, candidate))
  if (!forbidden) return
  report(
    'AC-3-forbidden-dependency',
    `import of "${specifier}" is forbidden: no messaging, Telegram automation, MTProto or mass-mail capability exists in the MVP.`,
  )
}

function checkProviderSdkBoundary(filePath, specifier, report) {
  if (!filePath.startsWith('backend/src/')) return
  if (filePath.startsWith('backend/src/providers/')) return

  const forbidden = providerOnlyPackages.find((candidate) => packageMatches(specifier, candidate))
  if (!forbidden) return

  report(
    'AC-1-provider-sdk-boundary',
    `provider SDKs and HTTP clients belong in backend/src/providers/** only; reach the outside world through a port ("${specifier}").`,
  )
}

function checkDirectNetworkCalls(filePath, source, report) {
  if (!filePath.startsWith('backend/src/modules/')) return

  // `fetch(` not preceded by a dot, so `response.fetch()` and `client.fetch()` do not match.
  // AC-1 catches imports; without this, global fetch would be the one way around it.
  const pattern = /(^|[^.\w])fetch\s*\(/g
  for (const match of source.matchAll(pattern)) {
    const offset = (match.index ?? 0) + match[0].indexOf('fetch')
    report(
      lineOf(source, offset),
      'AC-1-direct-network-call',
      'product modules must not call fetch directly; use a port in backend/src/providers/**.',
    )
  }
}

function checkLlmPersonalDataIsolation(filePath, specifier, report) {
  if (!filePath.startsWith('backend/src/providers/llm/')) return

  const target = resolveRepositoryImport(filePath, specifier)
  const targetModule = target?.match(/^backend\/src\/modules\/([^/]+)/)?.[1]
  if (!targetModule || !personalDataModules.includes(targetModule)) return

  report(
    'AC-2-llm-personal-data-isolation',
    `the LLM provider layer must not import personal-data module "${targetModule}" ("${specifier}"); the model receives keywords, brief structure and article text only.`,
  )
}

function checkBackendLayers(filePath, specifier, report) {
  const layer = filePath.match(
    /^backend\/src\/modules\/[^/]+\/(domain|application|transport|infrastructure)\//,
  )?.[1]
  if (!layer) return

  const importsPrisma =
    specifier.includes('generated/prisma') || packageMatches(specifier, '@prisma/')
  const isEnvImport = specifier.endsWith('/env') || specifier.includes('/env/')

  if (layer === 'domain' || layer === 'application') {
    const forbidden = applicationForbiddenPackages.find((candidate) =>
      packageMatches(specifier, candidate),
    )
    if (forbidden || importsPrisma) {
      report(
        'backend-layer-dependencies',
        `${layer} must not import framework, persistence or provider SDK code ("${specifier}").`,
      )
    }
    if (isEnvImport) {
      report(
        'backend-layer-dependencies',
        `${layer} must depend on ports and feature types, not on environment configuration ("${specifier}").`,
      )
    }
  }

  if (layer === 'transport') {
    const forbidden = transportForbiddenPackages.find((candidate) =>
      packageMatches(specifier, candidate),
    )
    if (forbidden || importsPrisma) {
      report(
        'backend-layer-dependencies',
        `transport must not import persistence or provider SDK code ("${specifier}").`,
      )
    }
  }

  const target = resolveRepositoryImport(filePath, specifier)
  const targetLayer = target?.match(
    /^backend\/src\/modules\/[^/]+\/(domain|application|transport|infrastructure)(?:\/|$)/,
  )?.[1]

  const invalidDirection =
    (layer === 'domain' && targetLayer && targetLayer !== 'domain') ||
    (layer === 'application' && (targetLayer === 'transport' || targetLayer === 'infrastructure')) ||
    (layer === 'transport' && targetLayer === 'infrastructure') ||
    (layer === 'infrastructure' && targetLayer === 'transport')

  if (invalidDirection) {
    report(
      'backend-layer-dependencies',
      `${layer} must not depend on outer layer ${targetLayer} ("${specifier}").`,
    )
  }
}

function checkBackendModuleBoundary(filePath, specifier, report) {
  const sourceModule = filePath.match(/^backend\/src\/modules\/([^/]+)\//)?.[1]
  const target = resolveRepositoryImport(filePath, specifier)
  const match = target?.match(/^backend\/src\/modules\/([^/]+)(?:\/(.*))?$/)
  if (!match || match[1] === sourceModule) return

  const inner = match[2]
  if (inner && inner !== 'index' && inner !== 'index.ts') {
    report(
      'backend-module-public-api',
      `module "${match[1]}" must be imported through its public index ("${specifier}").`,
    )
  }
}

function checkClientBoundary(filePath, specifier, report) {
  const client = filePath.match(/^(webapp)\/src\//)?.[1]
  if (!client) return

  const target = resolveRepositoryImport(filePath, specifier)
  if (!target) return

  const sourceFeature = filePath.match(new RegExp(`^${client}/src/features/([^/]+)/`))?.[1]
  const targetFeature = target.match(new RegExp(`^${client}/src/features/([^/]+)(?:/(.*))?$`))

  if (targetFeature) {
    const inner = targetFeature[2]
    const crossesBoundary = !sourceFeature || targetFeature[1] !== sourceFeature
    if (crossesBoundary && inner && inner !== 'index' && inner !== 'index.ts') {
      report(
        'client-feature-public-api',
        `feature "${targetFeature[1]}" must be imported through its public index ("${specifier}").`,
      )
    }

    const isLowerLayer =
      filePath.startsWith(`${client}/src/platform/`) ||
      filePath.startsWith(`${client}/src/components/ui/`)
    if (isLowerLayer) {
      report(
        'client-dependency-direction',
        `platform code and UI primitives must not import product features ("${specifier}").`,
      )
    }
  }
}

function checkContracts(filePath, specifier, report) {
  if (!filePath.startsWith('packages/contracts/src/')) return

  const target = resolveRepositoryImport(filePath, specifier)
  const forbiddenTarget = target && /^(backend|webapp|website)\//.test(target)
  const forbiddenPackage = contractForbiddenPackages.some((candidate) =>
    packageMatches(specifier, candidate),
  )

  if (forbiddenTarget || forbiddenPackage) {
    report(
      'contracts-dependency-direction',
      `contracts are the shared source of truth and must not import surface, framework or provider code ("${specifier}").`,
    )
  }
}

function resolveRepositoryImport(importer, specifier) {
  if (specifier.startsWith('.')) {
    return normalizePath(path.normalize(path.join(path.dirname(importer), specifier)))
  }

  if (specifier.startsWith('@/')) {
    const workspace = importer.split('/')[0]
    return `${workspace}/src/${specifier.slice(2)}`
  }

  const alias = specifier.match(/^@traffic\/(backend|contracts|webapp|website)(?:\/(.*))?$/)
  if (alias) {
    const workspace = alias[1] === 'contracts' ? 'packages/contracts' : alias[1]
    return `${workspace}/src/${alias[2] ?? 'index'}`
  }

  return null
}

export function extractImports(source) {
  const imports = []
  for (const pattern of [importPattern, runtimeModulePattern]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (!specifier) continue
      const offset = (match.index ?? 0) + match[0].lastIndexOf(specifier)
      imports.push({ specifier, line: lineOf(source, offset) })
    }
  }
  return imports
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function sortViolations(violations) {
  return violations.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.rule.localeCompare(right.rule),
  )
}

function normalizePath(filePath) {
  return filePath.replaceAll(path.sep, '/')
}

export function packageMatches(specifier, candidate) {
  if (candidate.endsWith('/')) return specifier.startsWith(candidate)
  return specifier === candidate || specifier.startsWith(`${candidate}/`)
}

async function collectSourceFiles(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const files = []
  for (const entry of entries) {
    if (skippedDirectories.has(entry.name) || entry.name.startsWith('.')) continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(entryPath)))
    else if (sourceExtension.test(entry.name)) files.push(entryPath)
  }
  return files
}

async function main() {
  const files = []
  const exempted = []
  for (const sourceRoot of sourceRoots) {
    for (const filePath of await collectSourceFiles(path.join(repositoryRoot, sourceRoot))) {
      const relativePath = path.relative(repositoryRoot, filePath)
      const source = await readFile(filePath, 'utf8')
      if (hasFixtureMarker(source)) {
        exempted.push(normalizePath(relativePath))
        continue
      }
      files.push({ path: relativePath, source })
    }
  }

  const manifests = []
  for (const manifestRoot of manifestGlobRoots) {
    const manifestPath = path.join(repositoryRoot, manifestRoot, 'package.json')
    try {
      manifests.push({
        path: path.relative(repositoryRoot, manifestPath),
        manifest: JSON.parse(await readFile(manifestPath, 'utf8')),
      })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  const violations = [...checkArchitectureSources(files), ...checkManifests(manifests)]

  // Printed on every run, not only on failure. An exemption nobody sees is how a checker
  // quietly stops covering the file that needed it most.
  for (const file of exempted) {
    console.log(`Exempt (${FIXTURE_MARKER}): ${file}`)
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.path}:${violation.line} [${violation.rule}] ${violation.message}`)
    }
    console.error(`\nArchitecture check failed with ${violations.length} violation(s).`)
    process.exitCode = 1
    return
  }

  // The counts are printed on purpose. A check that scanned nothing looks exactly like a
  // check that passed, and this is the line that tells the two apart.
  console.log(
    `Architecture check passed: ${files.length} source file(s) scanned, ${exempted.length} exempt, ${manifests.length} manifest(s), ${RULES.length} rule(s).`,
  )
}

if (import.meta.main) await main()
