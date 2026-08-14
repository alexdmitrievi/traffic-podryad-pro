/**
 * Resets the E2E database to a known state: empty product tables, seeded catalog,
 * one admin. Runs from the repository root.
 */

import { createDb } from '../../backend/src/db.ts'
import { createPasswordService } from '../../backend/src/modules/auth/index.ts'

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) {
  throw new Error('TEST_DATABASE_URL is required for the E2E run')
}

const db = createDb(url)

await db.$transaction(async (tx) => {
  await tx.attributionTouch.deleteMany()
  await tx.lead.deleteMany()
  await tx.publication.deleteMany()
  await tx.approval.deleteMany()
  await tx.contentRevision.deleteMany()
  await tx.contentItem.deleteMany()
  await tx.contentBrief.deleteMany()
  await tx.clusterKeyword.deleteMany()
  await tx.topicCluster.deleteMany()
  await tx.keywordMetric.deleteMany()
  await tx.keyword.deleteMany()
  await tx.serviceRequestPlan.deleteMany()
  await tx.serviceRequestEvent.deleteMany()
  await tx.serviceRequest.deleteMany()
  await tx.geoAnswerAsset.deleteMany()
  await tx.geoVisibilitySnapshot.deleteMany()
  await tx.geoQuery.deleteMany()
  await tx.citation.deleteMany()
  await tx.claim.deleteMany()
  await tx.evidenceSource.deleteMany()
  await tx.llmRun.deleteMany()
  await tx.taskOutbox.deleteMany()
  await tx.authSession.deleteMany()
  await tx.user.deleteMany()
})

const seed = await import('../../backend/prisma/seed/index.mjs')
await seed.applySeed(db, await seed.loadSeedData())

const passwords = createPasswordService()
await db.user.create({
  data: {
    email: 'e2e-admin@pipupi.ru',
    passwordHash: await passwords.hash('e2e-admin-password-123'),
    role: 'admin',
  },
})

await db.$disconnect()
console.log('[e2e] database reset and seeded')
