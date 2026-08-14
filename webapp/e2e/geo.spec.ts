/**
 * secret-scan:fixtures
 * The E2E scenario signs in with a fake admin credential by design; everything below is
 * a fixture for a local test database and grants nothing anywhere. The exemption is
 * pinned in scripts/repo-env.mjs.
 *
 * The GEO query inventory through the real interface (docs/GEO.md unit 2): a question
 * is recorded, triaged open → planned → answered, and a second one is dismissed with a
 * mandatory reason and stays frozen.
 */

import { expect, test } from '@playwright/test'

const ADMIN_EMAIL = 'e2e-admin@pipupi.ru'
const ADMIN_PASSWORD = 'e2e-admin-password-123'

test('a question is triaged and a dismissal freezes it with a reason', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('login-email').fill(ADMIN_EMAIL)
  await page.getByTestId('login-password').fill(ADMIN_PASSWORD)
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('nav-requests')).toBeVisible()

  await page.getByTestId('nav-geo').click()

  // ── Record and triage open → planned → answered ────────────────────────────
  await page.getByTestId('geo-question').fill('E2E: как купить дизельное топливо оптом в Омске?')
  await page.getByTestId('geo-priority').selectOption('high')
  await page.getByTestId('geo-create').click()

  const row = page.locator('tbody tr', { hasText: 'как купить дизельное топливо оптом в Омске?' })
  await expect(row).toBeVisible()
  await expect(row.getByText('open')).toBeVisible()

  await row.getByRole('button', { name: 'В план' }).click()
  await expect(row.getByText('planned')).toBeVisible({ timeout: 10_000 })

  await row.getByRole('button', { name: 'Отвечен' }).click()
  await expect(row.getByText('answered')).toBeVisible({ timeout: 10_000 })

  // ── Dismissal requires a reason and is terminal ────────────────────────────
  await page.getByTestId('geo-question').fill('E2E: почему цена на мазут меняется ежедневно?')
  await page.getByTestId('geo-create').click()

  const second = page.locator('tbody tr', { hasText: 'почему цена на мазут меняется ежедневно?' })
  await expect(second).toBeVisible()
  await second.getByRole('button', { name: 'Отклонить' }).click()

  await page.getByTestId('geo-dismiss-reason').fill('Повтор существующего вопроса.')
  await page.getByTestId('geo-dismiss-submit').click()

  await expect(second.getByText('dismissed')).toBeVisible({ timeout: 10_000 })
  await expect(second.getByText('Повтор существующего вопроса.')).toBeVisible()
  // Terminal: no further action buttons remain on the row.
  await expect(second.getByRole('button')).toHaveCount(0)
})
