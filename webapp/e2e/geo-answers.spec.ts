/**
 * secret-scan:fixtures
 * The E2E scenario signs in with a fake admin credential by design; everything below is
 * a fixture for a local test database and grants nothing anywhere. The exemption is
 * pinned in scripts/repo-env.mjs.
 *
 * GEO answer assets through the real interface (docs/GEO.md unit 4): a verified claim
 * is registered in the evidence screen, a planned question receives an answer built on
 * that claim, and the shared approval gate approves the asset and answers the question.
 */

import { expect, test } from '@playwright/test'

const ADMIN_EMAIL = 'e2e-admin@pipupi.ru'
const ADMIN_PASSWORD = 'e2e-admin-password-123'

const CLAIM = 'E2E: доставка по ассету выполняется автотранспортом производителя.'
const QUESTION = 'E2E: каким транспортом доставляете топливо в СФО?'
const SOURCE_TITLE = 'E2E: ТУ для ответного ассета'

test('an answer built on a verified claim is approved and answers the question', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('login-email').fill(ADMIN_EMAIL)
  await page.getByTestId('login-password').fill(ADMIN_PASSWORD)
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('nav-requests')).toBeVisible()

  // ── A verified claim through the evidence screen ───────────────────────────
  await page.getByTestId('nav-evidence').click()
  await page.getByTestId('source-title').fill(SOURCE_TITLE)
  await page.getByTestId('source-create').click()
  const sourceRow = page.locator('tbody tr', { hasText: SOURCE_TITLE })
  await sourceRow.getByRole('button', { name: 'Проверить' }).click()
  await expect(sourceRow.getByText('verified').first()).toBeVisible({ timeout: 10_000 })

  await page.getByTestId('claim-source').selectOption({ label: SOURCE_TITLE })
  await page.getByTestId('claim-statement').fill(CLAIM)
  await page.getByTestId('claim-location').fill('Раздел 4')
  await page.getByTestId('claim-create').click()
  const claimRow = page.locator('tbody tr', { hasText: 'доставка по ассету выполняется автотранспортом' })
  await claimRow.getByRole('button', { name: 'Проверить' }).click()
  await expect(claimRow.getByText('verified')).toBeVisible({ timeout: 10_000 })

  // ── A planned question receives an answer built on the claim ───────────────
  await page.getByTestId('nav-geo').click()
  await page.getByTestId('geo-question').fill(QUESTION)
  await page.getByTestId('geo-create').click()
  const questionRow = page.locator('tbody tr', { hasText: QUESTION }).first()
  await questionRow.getByRole('button', { name: 'В план' }).click()
  await expect(questionRow.getByText('planned')).toBeVisible({ timeout: 10_000 })

  await page.getByTestId('answer-create-query').selectOption({ label: QUESTION })
  await page.getByTestId('answer-create').click()
  await expect(page.getByTestId('answer-body')).toBeVisible()

  await page
    .locator('label.claim-check', { hasText: CLAIM.slice(0, 40) })
    .locator('input')
    .check()
  await page.getByTestId('answer-body').fill('Доставка выполняется автотранспортом производителя.')
  await page.getByTestId('answer-save').click()
  await expect(page.getByText('Ответ сохранён; хеш обновлён.')).toBeVisible({ timeout: 10_000 })

  await page.getByTestId('answer-approve').click()
  await expect(page.getByText('Ответ одобрен; вопрос перешёл в answered.')).toBeVisible({ timeout: 10_000 })

  const answerRow = page.locator('tbody tr', { hasText: QUESTION }).last()
  await expect(answerRow.getByText('approved')).toBeVisible({ timeout: 10_000 })
  await expect(questionRow.getByText('answered')).toBeVisible({ timeout: 10_000 })
})
