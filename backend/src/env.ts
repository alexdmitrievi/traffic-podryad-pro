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

  // ── Auth ────────────────────────────────────────────────────────────────────
  jwtSecret: string
  accessTokenTtlSeconds: number
  refreshTokenTtlDays: number
  sessionAbsoluteTtlDays: number
  sessionRetentionDays: number
  authRateLimitMax: number
  authRateLimitWindowSeconds: number
  trustedProxyClientIpHeader: string
  authCookieName: string
  authCookiePath: '/'
  authCookieSameSite: 'lax' | 'strict'

  // ── HTTP surfaces ───────────────────────────────────────────────────────────
  corsPublicOrigins: string[]
  corsAppOrigins: string[]
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

function readJwtSecret(source: Record<string, string | undefined>): string {
  const value = readString(source, 'JWT_SECRET')
  if (value === undefined) {
    throw new EnvValidationError(['JWT_SECRET is required'])
  }
  if (value === 'REPLACE_ME') {
    throw new EnvValidationError(['JWT_SECRET is still the placeholder; refusing to start'])
  }
  if (value.length < 32) {
    throw new EnvValidationError(['JWT_SECRET must be at least 32 characters; refusing to start'])
  }
  return value
}

function readPositiveInt(
  source: Record<string, string | undefined>,
  key: string,
  defaultValue: number,
): number {
  const raw = readString(source, key)
  if (raw === undefined) return defaultValue
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new EnvValidationError([`${key} must be a positive integer, got "${raw}"`])
  }
  return value
}

/**
 * The cookie path is part of the security model: it must reach every authenticated route,
 * and narrowing it breaks authorization while protecting nothing (docs/DOMAINS.md section 4).
 */
function readAuthCookiePath(source: Record<string, string | undefined>): '/' {
  const value = readString(source, 'AUTH_COOKIE_PATH')
  if (value !== '/') {
    throw new EnvValidationError([
      `AUTH_COOKIE_PATH must be "/" — the cookie has to reach every authenticated route; got "${value ?? '(missing)'}"`,
    ])
  }
  return '/'
}

function readAuthCookieSameSite(source: Record<string, string | undefined>): 'lax' | 'strict' {
  const value = readString(source, 'AUTH_COOKIE_SAMESITE') ?? 'lax'
  if (value !== 'lax' && value !== 'strict') {
    throw new EnvValidationError([
      `AUTH_COOKIE_SAMESITE must be "lax" or "strict", got "${value}"`,
    ])
  }
  return value
}

const originPattern = /^https?:\/\/[^/]+$/

function readOrigins(source: Record<string, string | undefined>, key: string): string[] {
  const raw = readString(source, key)
  if (raw === undefined) {
    throw new EnvValidationError([`${key} is required: exact origins, never a wildcard`])
  }
  const origins = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  if (origins.length === 0) {
    throw new EnvValidationError([`${key} must contain at least one origin`])
  }
  for (const origin of origins) {
    if (!originPattern.test(origin)) {
      throw new EnvValidationError([`${key} entry "${origin}" is not a valid http(s) origin`])
    }
  }
  return origins
}

export function loadEnv(source: Record<string, string | undefined>): Env {
  // Order matters for diagnostics: the fuses and the database URL are validated before
  // anything that depends on them, so a broken guard is reported as the guard, not as a
  // downstream symptom.
  const nodeEnv = readNodeEnv(source)
  const requireHumanApproval = readFuse(source, 'REQUIRE_HUMAN_APPROVAL', true)
  const outboundMessagingEnabled = readFuse(source, 'OUTBOUND_MESSAGING_ENABLED', false)
  const piiToLlmAllowed = readFuse(source, 'PII_TO_LLM_ALLOWED', false)
  const databaseUrl = readDatabaseUrl(source)
  const authCookieSecure = readAuthCookieSecure(source, nodeEnv)

  const jwtSecret = readJwtSecret(source)
  const corsPublicOrigins = readOrigins(source, 'CORS_PUBLIC_ORIGINS')
  const corsAppOrigins = readOrigins(source, 'CORS_APP_ORIGINS')
  const overlapping = corsPublicOrigins.filter((origin) => corsAppOrigins.includes(origin))
  if (overlapping.length > 0) {
    throw new EnvValidationError([
      `CORS_PUBLIC_ORIGINS and CORS_APP_ORIGINS must not overlap (${overlapping.join(', ')}): the two policies exist because they differ in credentials`,
    ])
  }

  return {
    nodeEnv,
    port: readPort(source),
    databaseUrl,
    requireHumanApproval,
    outboundMessagingEnabled,
    piiToLlmAllowed,
    authCookieSecure,
    jwtSecret,
    accessTokenTtlSeconds: readPositiveInt(source, 'ACCESS_TOKEN_TTL_SECONDS', 900),
    refreshTokenTtlDays: readPositiveInt(source, 'REFRESH_TOKEN_TTL_DAYS', 30),
    sessionAbsoluteTtlDays: readPositiveInt(source, 'SESSION_ABSOLUTE_TTL_DAYS', 90),
    sessionRetentionDays: readPositiveInt(source, 'SESSION_RETENTION_DAYS', 30),
    authRateLimitMax: readPositiveInt(source, 'AUTH_RATE_LIMIT_MAX', 20),
    authRateLimitWindowSeconds: readPositiveInt(source, 'AUTH_RATE_LIMIT_WINDOW_SECONDS', 60),
    trustedProxyClientIpHeader: readString(source, 'TRUSTED_PROXY_CLIENT_IP_HEADER') ?? 'x-forwarded-for',
    authCookieName: readString(source, 'AUTH_COOKIE_NAME') ?? 'pip_rt',
    authCookiePath: readAuthCookiePath(source),
    authCookieSameSite: readAuthCookieSameSite(source),
    corsPublicOrigins,
    corsAppOrigins,
  }
}

export function describeEnvError(error: unknown): string {
  if (error instanceof EnvValidationError) return error.message
  return error instanceof Error ? error.message : String(error)
}
