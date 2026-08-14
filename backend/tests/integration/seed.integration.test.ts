import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
// The seed is plain JavaScript on purpose: `seed:check` runs in CI before `prisma
// generate`, so the module must not statically import the generated client. Its public
// surface is exercised by the seed's own tests and by this integration suite.
// @ts-expect-error — JavaScript module without a declaration file
import { applySeed, loadSeedData } from '../../prisma/seed/index.mjs'
import { createTestDb } from './helpers'
import type { Db } from '../../src/db'

let db: Db

describe('catalog seed against a real database', () => {
  beforeAll(() => {
    db = createTestDb()
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  test('applySeed writes the workspace, regions and vertical and is idempotent', async () => {
    const data = await loadSeedData()

    await applySeed(db, data)
    const firstRun = {
      workspaces: await db.workspace.count(),
      regions: await db.region.count(),
      verticals: await db.vertical.count(),
      categories: await db.productCategory.count(),
      products: await db.product.count(),
      deliveryBases: await db.deliveryBasis.count(),
    }

    await applySeed(db, data)
    const secondRun = {
      workspaces: await db.workspace.count(),
      regions: await db.region.count(),
      verticals: await db.vertical.count(),
      categories: await db.productCategory.count(),
      products: await db.product.count(),
      deliveryBases: await db.deliveryBasis.count(),
    }

    expect(secondRun).toEqual(firstRun)
    expect(firstRun.workspaces).toBe(1)
    expect(firstRun.regions).toBeGreaterThan(0)
    expect(firstRun.verticals).toBe(1)
    expect(firstRun.categories).toBeGreaterThan(0)
    expect(firstRun.products).toBeGreaterThan(0)
  })

  test('the region tree resolves: children point at their parents', async () => {
    const cities = await db.region.findMany({ where: { kind: 'city' }, include: { parent: true } })
    expect(cities.length).toBeGreaterThan(0)
    for (const city of cities) {
      expect(city.parentId).not.toBeNull()
      expect(city.parent).not.toBeNull()
    }
  })

  test('products carry the seeded synonyms and no specification fields', async () => {
    const diesel = await db.product.findFirstOrThrow({
      where: { slug: 'dizelnoe-toplivo' },
    })

    expect(diesel.synonyms).toContain('солярка')
    expect(diesel.unit).toBe('tonne')
  })
})
