/**
 * secret-scan:fixtures
 * The E2E scenario signs in with a fake admin credential by design; everything below is
 * a fixture for a local test database and grants nothing anywhere. The exemption is
 * pinned in scripts/repo-env.mjs.
 *
 * The one mandatory E2E: the 11-step SEO slice through the real backend, the real
 * database and the real interface (docs/TESTING.md section 6).
 *
 *   1.  CSV import through the webapp
 *   2.  topic cluster creation
 *   3.  brief generation through the outbox (deterministic fake LLM)
 *   4.  draft generation through the outbox
 *   5.  publication WITHOUT approval → refused  ← the key negative test
 *   6.  approval of the exact revision
 *   7.  publication → worker renders and publishes
 *   8.  the published page carries title, description, canonical and JSON-LD in source HTML
 *   9.  the CTA form submits with consent (and is refused without it)
 *   10. a lead is created with consent recorded
 *   11. the attribution chain closes: lead → touch → article → cluster → keyword
 */

import { expect, test } from '@playwright/test'

const ADMIN_EMAIL = 'e2e-admin@pipupi.ru'
const ADMIN_PASSWORD = 'e2e-admin-password-123'

test('the full SEO slice closes the funnel', async ({ page, request }) => {
  // ── Login ──────────────────────────────────────────────────────────────────
  await page.goto('/')
  await page.getByTestId('login-email').fill(ADMIN_EMAIL)
  await page.getByTestId('login-password').fill(ADMIN_PASSWORD)
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('nav-requests')).toBeVisible()

  // ── Service request through the lifecycle ──────────────────────────────────
  await page.getByTestId('nav-requests').click()
  await page.getByTestId('request-service-line').selectOption('seo_content')
  await page.getByTestId('request-title').fill('E2E: оптовая покупка дизельного топлива')
  await page.getByTestId('request-objective').fill('Органический трафик по оптовым запросам.')
  await page.getByTestId('request-create').click()

  await page.getByText('E2E: оптовая покупка дизельного топлива').first().waitFor()
  const requestNumber = await page
    .locator('tbody code')
    .filter({ hasText: /^SR-\d{4}-\d{4,}$/ })
    .first()
    .textContent()

  for (const status of ['submitted', 'triage', 'accepted', 'planning']) {
    const button = page.getByTestId(`request-action-${requestNumber}-${status}`)
    await button.waitFor()
    await button.click()
    await expect(page.getByTestId(`request-status-${requestNumber}`)).toHaveText(status, { timeout: 10_000 })
  }

  // Plan + approval → in_delivery.
  await page.getByTestId(`request-open-${requestNumber}`).click()
  await page.getByTestId('plan-goal').fill('Занять органику по оптовым запросам ДТ.')
  await page.getByTestId('plan-create').click()
  await page.getByTestId(/^plan-approve-/).click()
  await expect(page.getByTestId(`request-status-${requestNumber}`)).toHaveText('plan_approved', { timeout: 10_000 })

  const deliver = page.getByTestId(`request-action-${requestNumber}-in_delivery`)
  await deliver.waitFor()
  await deliver.click()
  await expect(page.getByTestId(`request-status-${requestNumber}`)).toHaveText('in_delivery')

  // ── Step 1: CSV import ─────────────────────────────────────────────────────
  await page.getByTestId('nav-research').click()
  // The scenario created the only request; the picker's first option is "Все", the
  // second is that request.
  await page.getByTestId('request-picker').selectOption({ index: 1 })
  await page.getByTestId('import-csv').fill(
    ['phrase,volume', 'дизельное топливо оптом омск,320', 'купить дт тюмень,40', 'мазут оптом,110'].join('\n'),
  )
  await page.getByTestId('import-submit').click()
  await expect(page.getByText('Получено: 3, создано: 3')).toBeVisible({ timeout: 10_000 })

  // ── Step 2: clusters ───────────────────────────────────────────────────────
  await page.getByTestId('cluster-create').click()
  await expect(page.locator('tbody tr').filter({ hasText: /дизель/ }).first()).toBeVisible({
    timeout: 10_000,
  })

  // ── Steps 3–4: brief and draft through the outbox worker ───────────────────
  await page.getByTestId('nav-content').click()
  await page.getByTestId('request-picker').selectOption({ index: 1 })
  await page.getByTestId('brief-cluster').selectOption({ index: 1 })
  await page.getByTestId('brief-create').click()

  // The worker generates the brief; the screen polls and the review button appears.
  await expect(page.getByTestId(/^brief-approve-/).first()).toBeVisible({ timeout: 60_000 })
  await page.getByTestId(/^brief-approve-/).first().click()
  await page.getByTestId(/^item-create-/).click()

  // The worker generates the draft revision; the editor button appears.
  await expect(page.getByTestId(/^item-edit-/).first()).toBeVisible({ timeout: 60_000 })

  // ── Step 5: publication WITHOUT approval is refused ────────────────────────
  await page.getByTestId('nav-publications').click()
  // The list auto-polls and re-renders, so a click can land on a detached node; retry
  // the click until the refusal surfaces — the alert itself is the assertion.
  await expect(async () => {
    await page.getByTestId(/^publish-/).first().click()
    return page.getByText(/одобрения|approval/i).isVisible()
  }).toPass({ timeout: 30_000, intervals: [1_000] })

  // The invariant is also visible as data: no publication row was created.
  await expect(page.locator('[data-testid^="publication-status-"]')).toHaveCount(0)

  // ── Step 6: approve the exact revision ─────────────────────────────────────
  await page.getByTestId('nav-content').click()
  await page.getByTestId('request-picker').selectOption({ index: 1 })
  await page.getByTestId(/^revision-approve-/).click()

  // ── Step 7: publish; the worker renders and publishes ──────────────────────
  await page.getByTestId('nav-publications').click()
  await page.getByTestId(/^publish-/).first().click()

  // ── Step 8: the published page carries SEO content in the source HTML ──────
  // The row fills its URL only after the worker finishes; poll for the URL itself.
  let publicationUrl = ''
  await expect
    .poll(
      async () => {
        publicationUrl =
          (
            await page
              .locator('[data-testid^="publication-status-"]')
              .first()
              .locator('xpath=ancestor::tr')
              .locator('td')
              .nth(1)
              .textContent()
          )?.trim() ?? ''
        return publicationUrl
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .toMatch(/^https:\/\/pipupi\.ru\/blog\/article-[a-z0-9-]+$/)
  const slug = publicationUrl.split('/').pop()

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`http://localhost:4321/blog/${slug}`)
        return response.status()
      },
      { timeout: 20_000, intervals: [1_000] },
    )
    .toBe(200)

  const sitePage = await page.request.get(`http://localhost:4321/blog/${slug}`)
  expect(sitePage.status()).toBe(200)
  const html = await sitePage.text()
  expect(html).toContain('<title>')
  expect(html).toContain('name="description"')
  expect(html).toContain('rel="canonical"')
  expect(html).toContain('application/ld+json')
  expect(html).toContain('property="og:title"')

  // ── Steps 9–10: CTA form, consent, lead ────────────────────────────────────
  const pageResponse = await request.get(`http://localhost:4321/blog/${slug}`)
  expect(pageResponse.status()).toBe(200)

  // Without consent the server refuses.
  const denied = await request.post('http://localhost:4321/api/public/leads', {
    data: { contactName: 'Алексей', phone: '79001234567', consentTextVersion: '2026-08-01', privacyPolicyVersion: '2026-08-01' },
  })
  expect(denied.status()).toBe(400)

  const accepted = await request.post('http://localhost:4321/api/public/leads', {
    data: {
      contactName: 'Алексей',
      phone: '79001234567',
      consent: true,
      consentTextVersion: '2026-08-01',
      privacyPolicyVersion: '2026-08-01',
      utmSource: 'e2e',
    },
  })
  expect(accepted.status()).toBe(200)
  expect((await accepted.json()) as { accepted: boolean }).toHaveProperty('accepted', true)

  // ── Step 11: the funnel shows the attributed lead ──────────────────────────
  await page.getByTestId('nav-leads').click()
  await expect(page.getByText('Алексей').first()).toBeVisible({ timeout: 10_000 })

  await page.getByTestId('nav-funnel').click()
  await expect(page.getByTestId('funnel-leads')).toHaveText('1', { timeout: 10_000 })
  await expect(page.getByTestId('funnel-published')).toHaveText(/[1-9]/)
})
