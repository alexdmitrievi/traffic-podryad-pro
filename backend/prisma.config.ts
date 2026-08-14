/**
 * Prisma 7 configuration for the Pipupi backend.
 *
 * Prisma 7 keeps connection URLs out of schema.prisma entirely: the CLI resolves the
 * datasource URL from this file through `env('DATABASE_URL')`. The local `.env` is loaded
 * when present (it is git-ignored); in CI and production the variables come from the
 * environment and no file exists.
 *
 * The .env loader is hand-rolled on purpose: `process.loadEnvFile` does not exist in every
 * runtime the Prisma CLI ends up running under (the oven/bun image ships no Node), and the
 * Prisma CLI must be able to load this config everywhere. Values already present in the
 * environment win — the same semantics the repository checks use.
 *
 * The seed command only validates the catalog datasets — writing rows requires the `--write`
 * flag, see backend/prisma/seed/index.mjs.
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { defineConfig, env } from 'prisma/config'

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadDotEnv('.env')

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun prisma/seed/index.mjs',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
