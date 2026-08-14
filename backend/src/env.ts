/**
 * Environment parsing and validation for the backend process.
 *
 * The three compliance fuses are validated here, at process start, and a disagreement with
 * the project phase is a refusal to boot — a non-zero exit code, never a warning in the log.
 * docs/COMPLIANCE.md section 6 and docs/WAVE_4_DELEGATION.md section 4a make this load-bearing:
 * a product that runs with a switched-off guard is more dangerous than one that did not start.
 *
 * `loadEnv` is a pure function over a string record so the refusal logic itself is unit
 * testable; the entrypoints turn a thrown EnvValidationError into `process.exit(1)`.
 */

export type NodeEnv = 'development' | 'test' | 'production'

export interface Env {
  nodeEnv: NodeEnv
  port: number
  databaseUrl: string
  /** MVP fuses. After validation the types are literal, so a guarded value is visible at
   *  compile time everywhere the Env object flows. */
  requireHumanApproval: true
  outboundMessagingEnabled: false
  piiToLlmAllowed: false
  authCookieSecure: boolean
}

export class EnvValidationError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`environment validation failed:\n  - ${problems.join('\n  - ')}`)
    this.name = 'EnvValidationError'
    this.problems = problems
  }
}

function readString(source: Record<string, string | undefined>, key: string): string | undefined {
  const value = source[key]
  return value === undefined || value === '' ? undefined : value
}

function readBoolean(source: Record<string, string | undefined>, key: string): boolean | undefined {
  const value = readString(source, key)
  if (value === undefined) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function readPort(source: Record<string, string | undefined>): number {
  const raw = readString(source, 'PORT')
  if (raw === undefined) return 8080
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EnvValidationError([`PORT must be an integer between 1 and 65535, got "${raw}"`])
  }
  return port
}

function readNodeEnv(source: Record<string, string | undefined>): NodeEnv {
  const raw = readString(source, 'NODE_ENV')
  if (raw === undefined) return 'development'
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw
  throw new EnvValidationError([`NODE_ENV must be development, test or production, got "${raw}"`])
}

function readDatabaseUrl(source: Record<string, string | undefined>): string {
  const raw = readString(source, 'DATABASE_URL')
  if (raw === undefined) {
    throw new EnvValidationError(['DATABASE_URL is required'])
  }
  if (!/^postgres(ql)?:\/\//.test(raw)) {
    throw new EnvValidationError([`DATABASE_URL must be a postgres:// URL, got a value that is not one`])
  }
  return raw
}

/**
 * A fuse checked against the MVP phase. Missing or any other value is a refusal: a guard that
 * does not hold its expected value is the one state the product must never run in, and a
 * missing variable means nobody set the guard on purpose. The expected value is a literal
 * so the parsed Env carries the guard's truth as a type, visible at every call site.
 */
function readFuse<V extends boolean>(source: Record<string, string | undefined>, key: string, expected: V): V {
  const value = readBoolean(source, key)
  if (value !== expected) {
    throw new EnvValidationError([
      `${key} must be "${expected}" in the MVP; refusing to start (docs/COMPLIANCE.md section 6)`,
    ])
  }
  return value as V
}

function readAuthCookieSecure(source: Record<string, string | undefined>, nodeEnv: NodeEnv): boolean {
  const value = readBoolean(source, 'AUTH_COOKIE_SECURE')
  if (value === undefined) {
    throw new EnvValidationError(['AUTH_COOKIE_SECURE is required (true in production, false only locally)'])
  }
  if (nodeEnv === 'production' && value === false) {
    throw new EnvValidationError([
      'AUTH_COOKIE_SECURE=false is allowed only outside production; refusing to start',
    ])
  }
  return value
}

export function loadEnv(source: Record<string, string | undefined>): Env {
  const nodeEnv = readNodeEnv(source)
  const requireHumanApproval = readFuse(source, 'REQUIRE_HUMAN_APPROVAL', true)
  const outboundMessagingEnabled = readFuse(source, 'OUTBOUND_MESSAGING_ENABLED', false)
  const piiToLlmAllowed = readFuse(source, 'PII_TO_LLM_ALLOWED', false)

  return {
    nodeEnv,
    port: readPort(source),
    databaseUrl: readDatabaseUrl(source),
    requireHumanApproval,
    outboundMessagingEnabled,
    piiToLlmAllowed,
    authCookieSecure: readAuthCookieSecure(source, nodeEnv),
  }
}

export function describeEnvError(error: unknown): string {
  if (error instanceof EnvValidationError) return error.message
  return error instanceof Error ? error.message : String(error)
}
