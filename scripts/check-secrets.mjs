/**
 * Secret scanner for Pipupi.
 *
 * Blocks credentials from entering the repository. Dependency-free so it runs before
 * anything is installed and cannot be disabled by a broken dependency tree.
 *
 * Why this exists as a build gate rather than a review habit: a leaked secret is not
 * fixed by deleting the file. It stays in Git history and has to be revoked and reissued.
 * The cheapest moment to catch it is before the commit.
 *
 * On self-matching: the detection patterns below are written so they do not match their
 * own source text. Every pattern is anchored on a literal prefix followed by a character
 * class, and `[` is never a member of that class, so the pattern source cannot satisfy it.
 * `scripts/check-secrets.test.mjs` asserts this file scans clean, which keeps the property
 * true as patterns are added.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const skippedDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.astro',
  '.vite',
  '.scratch',
  'playwright-report',
  'test-results',
])

const skippedExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg',
  '.pdf', '.zip', '.gz', '.tar', '.woff', '.woff2', '.ttf', '.eot',
  '.mp4', '.webm', '.mp3', '.lock', '.lockb',
])

const MAX_FILE_BYTES = 2 * 1024 * 1024

/**
 * A file whose job is to contain fake credentials declares it with this marker near the top.
 *
 * The exemption is deliberately inline rather than a path list in this script: it is visible
 * in the exempted file itself, it cannot be added by editing a config far away from the
 * content it excuses, and every run prints which files used it. `scripts/repo-env.mjs`
 * asserts the set of marked files against an expected allowlist, so a new exemption cannot
 * appear without a second, deliberate change.
 */
export const FIXTURE_MARKER = 'secret-scan:fixtures'
const MARKER_SCAN_LINES = 30

export function hasFixtureMarker(source) {
  return source.split('\n', MARKER_SCAN_LINES).join('\n').includes(FIXTURE_MARKER)
}

/** High-confidence credential shapes. A match is a finding, with no placeholder escape. */
export const credentialPatterns = [
  { id: 'openai-style-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { id: 'github-fine-grained-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'aws-access-key-id', pattern: /\bAKIA[A-Z0-9]{16}\b/g },
  { id: 'google-api-key', pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/g },
  { id: 'jwt', pattern: /\bey[A-Za-z0-9_-]{8,}\.ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: 'private-key-block', pattern: /-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}/g },
  { id: 'telegram-bot-token', pattern: /\b\d{8,12}:AA[A-Za-z0-9_-]{30,}\b/g },
]

/**
 * Assignments that look like a credential. Placeholders are allowed.
 *
 * The horizontal-whitespace classes around the separator are deliberate. With `\s*` the
 * pattern crosses newlines, so an intentionally empty `SECRET=` swallows the next line and
 * reports it as the value — an empty credential is exactly what a tracked file should hold,
 * so that false positive would train people to ignore the scanner.
 */
export const assignmentPattern =
  /(?<name>[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|credential|private[_-]?key)[A-Za-z0-9_.-]*)[ \t]*[:=][ \t]*["']?(?<value>[A-Za-z0-9_\-+=./:]{12,})["']?/gi

/**
 * A credential-shaped value carries at least one digit.
 *
 * Without this, `const secretScanExemptions = fixtureExemptions` reads as a credential
 * assignment: the name matches and the value is a long run of letters. Requiring a digit
 * drops identifier references and keeps real tokens, which are mixed alphanumeric by
 * construction. The cost is an all-alphabetic secret with no digits — low-entropy, and the
 * structured patterns above already cover every token format that has a known shape.
 */
const looksLikeOpaqueValue = /\d/

/** A connection string carrying an inline password. Local hosts are exempt. */
export const connectionStringPattern =
  /\b[a-z][a-z0-9+.-]*:\/\/(?<user>[^\s:@/]+):(?<password>[^\s:@/]+)@(?<host>[^\s/:]+)/gi

const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'postgres', 'postgres_test'])

/**
 * Values that are obviously not credentials. Kept deliberately narrow: every entry here is
 * a hole in the scanner, so each one has to be a shape a real secret would never take.
 */
const placeholderPattern =
  /^(?:$|replace[_-]?me\b|replace[_-]?with[_-]|your[_-]|<.*>|\{\{.*\}\}|\$\{.*\}|change[_-]?me\b|placeholder|example|sample|dummy|fake|unset|none|null|undefined|todo|x{4,}|\*{4,}|\.{3,})/i

const placeholderSubstringPattern = /(?:local|not[_-]a[_-]real|example|placeholder|dev[_-]only|test[_-]only|REPLACE)/i

export function isPlaceholder(value) {
  if (value === undefined || value === null) return true
  const trimmed = String(value).trim().replace(/^["']|["']$/g, '')
  if (trimmed === '') return true
  if (placeholderPattern.test(trimmed)) return true
  if (placeholderSubstringPattern.test(trimmed)) return true
  return false
}

/**
 * @param {{path: string, source: string}[]} files
 * @returns {{path: string, line: number, rule: string, message: string}[]}
 */
export function scanFiles(files) {
  const findings = []

  for (const file of files) {
    const filePath = file.path.replaceAll(path.sep, '/')
    if (hasFixtureMarker(file.source)) continue
    const add = (offset, rule, message) =>
      findings.push({ path: filePath, line: lineOf(file.source, offset), rule, message })

    for (const { id, pattern } of credentialPatterns) {
      for (const match of file.source.matchAll(new RegExp(pattern.source, pattern.flags))) {
        add(match.index ?? 0, id, `looks like a credential (${id}); revoke and reissue it if real.`)
      }
    }

    for (const match of file.source.matchAll(new RegExp(assignmentPattern.source, assignmentPattern.flags))) {
      const { name, value } = match.groups ?? {}
      if (isPlaceholder(value)) continue
      if (!looksLikeOpaqueValue.test(String(value))) continue
      add(
        match.index ?? 0,
        'assigned-credential',
        `"${name}" is assigned a concrete value; use an empty value or a marked placeholder in a tracked file.`,
      )
    }

    for (const match of file.source.matchAll(new RegExp(connectionStringPattern.source, connectionStringPattern.flags))) {
      const { password, host } = match.groups ?? {}
      if (localHosts.has(String(host).toLowerCase())) continue
      if (isPlaceholder(password)) continue
      add(
        match.index ?? 0,
        'connection-string-credential',
        `connection string embeds a password for host "${host}"; keep production connection strings in the platform secret store.`,
      )
    }
  }

  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line || left.rule.localeCompare(right.rule),
  )
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length
}

async function collectFiles(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const files = []
  for (const entry of entries) {
    if (skippedDirectories.has(entry.name)) continue
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)))
      continue
    }
    if (!entry.isFile()) continue
    if (skippedExtensions.has(path.extname(entry.name).toLowerCase())) continue

    const info = await stat(entryPath)
    if (info.size > MAX_FILE_BYTES) continue
    files.push(entryPath)
  }
  return files
}

async function main() {
  const paths = await collectFiles(repositoryRoot)
  const files = []
  for (const filePath of paths) {
    files.push({
      path: path.relative(repositoryRoot, filePath),
      source: await readFile(filePath, 'utf8'),
    })
  }

  const findings = scanFiles(files)
  const exempted = files.filter((file) => hasFixtureMarker(file.source)).map((file) => file.path)

  // Exemptions are printed on every run, not just on failure. An exemption nobody sees is
  // how a scanner quietly stops covering the file that needed it most.
  for (const file of exempted) {
    console.log(`Exempt (${FIXTURE_MARKER}): ${file}`)
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.path}:${finding.line} [${finding.rule}] ${finding.message}`)
    }
    console.error(
      `\nSecret scan failed with ${findings.length} finding(s). A committed secret must be revoked and reissued, not merely deleted.`,
    )
    process.exitCode = 1
    return
  }

  console.log(
    `Secret scan passed: ${files.length - exempted.length} file(s) scanned, ${exempted.length} exempt, ${credentialPatterns.length + 2} pattern(s).`,
  )
}

if (import.meta.main) await main()
