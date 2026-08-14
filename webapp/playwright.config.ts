import { defineConfig } from '@playwright/test'

const backendEnv = {
  NODE_ENV: 'test',
  PORT: '8080',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://pipupi:pipupi_local_password@localhost:54330/pipupi_test',
  REQUIRE_HUMAN_APPROVAL: 'true',
  OUTBOUND_MESSAGING_ENABLED: 'false',
  PII_TO_LLM_ALLOWED: 'false',
  AUTH_COOKIE_SECURE: 'false',
  JWT_SECRET: 'e2e-local-test-secret-0123456789abcdef',
  AUTH_COOKIE_PATH: '/',
  CORS_PUBLIC_ORIGINS: 'http://localhost:4321',
  CORS_APP_ORIGINS: 'http://localhost:5173',
  LLM_PROVIDER: 'fake',
}

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  globalSetup: './e2e/global-setup.mjs',
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'bun ../webapp/e2e/backend-servers.mjs',
      // The backend cwd keeps the publishing driver's `.storage/public` under backend/,
      // which is where the site server reads the published article files from.
      cwd: '../backend',
      url: 'http://localhost:8080/health',
      reuseExistingServer: false,
      env: backendEnv,
      timeout: 60_000,
    },
    {
      command: 'bun e2e/site-server.mjs',
      cwd: '.',
      env: { SITE_PORT: '4321' },
      url: 'http://localhost:4321/services/seo-content',
      reuseExistingServer: false,
    },
    {
      command: 'bun run build && bunx vite preview --port 5173 --strictPort',
      cwd: '.',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
