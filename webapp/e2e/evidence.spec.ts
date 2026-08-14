/**
 * secret-scan:fixtures
 * The E2E scenario signs in with a fake admin credential by design; everything below is
 * a fixture for a local test database and grants nothing anywhere. The exemption is
 * pinned in scripts/repo-env.mjs.
 *
 * The evidence registry through the real interface (docs/GEO.md unit 1): a source is
 * created and verified, a claim with a citation is extracted and verified, and a
 * correction supersedes it — the old claim stays in history, the replacement is
 * verified again.
 */

import { expect, test } from '@playwright/test'

const ADMIN_EMAIL = 'e2e-admin@pipupi.ru'
const ADMIN_PASSWORD = 'e2e-admin-password-123'

test('a fact travels from source to verified claim through corrections', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('login-email').fill(ADMIN_EMAIL)
  await page.getByTestId('login-password').fill(ADMIN_PASSWORD)
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('nav-requests')).toBeVisible()

  await page.getByTestId('nav-evidence').click()

  // ── Source: create, then verify ─────────────────────────────────────────────
  await page.getByTestId('source-title').fill('E2E: технические условия производителя')
  await page.getByTestId('source-create').click()
  await expect(page.getByText('E2E: технические условия производителя').first()).toBeVisible()

  const sourceRow = page.locator('tbody tr', { hasText: 'E2E: технические условия производителя' })
  await sourceRow.getByRole('button', { name: 'Проверить' }).click()
  await expect(sourceRow.getByText('verified')).toBeVisible({ timeout: 10_000 })

  // ── Claim: extract with a citation, then verify ─────────────────────────────
  await page.getByTestId('claim-source').selectOption({ label: 'E2E: технические условия производителя' })
  await page.getByTestId('claim-statement').fill('E2E: отгрузка выполняется автотранспортом производителя.')
  await page.getByTestId('claim-location').fill('Раздел 4')
  await page.getByTestId('claim-create').click()

  const claimRow = page.locator('tbody tr', { hasText: 'автотранспортом' })
  await expect(claimRow).toBeVisible()
  await claimRow.getByRole('button', { name: 'Проверить' }).click()
  await expect(claimRow.getByText('verified')).toBeVisible({ timeout: 10_000 })

  // ── Correction: supersede, the old claim freezes, the replacement is verified ──
  await claimRow.getByRole('button', { name: 'Исправить' }).click()
  await page.getByTestId('claim-corrected-statement').fill('E2E: отгрузка выполняется железнодорожным транспортом.')
  await page.getByTestId('claim-supersede-submit').click()

  const oldRow = page.locator('tbody tr', { hasText: 'автотранспортом' })
  await expect(oldRow.getByText('superseded')).toBeVisible({ timeout: 10_000 })

  const newRow = page.locator('tbody tr', { hasText: 'железнодорожным транспортом' })
  await expect(newRow.getByText('unverified')).toBeVisible()
  await newRow.getByRole('button', { name: 'Проверить' }).click()
  await expect(newRow.getByText('verified')).toBeVisible({ timeout: 10_000 })
})
