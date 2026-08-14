/**
 * Catalog seed: loads, validates and normalizes reference data.
 *
 * The catalog is a module, not a fixed taxonomy. Adding a niche is a JSON file next to
 * `data/verticals/petroleum-wholesale.json` and a line in `verticalFiles` below — no schema
 * change, no code change, no migration. Petroleum wholesale is the first workspace we
 * validate the SEO slice on, and nothing in this loader knows what a fuel is.
 *
 * What this file does today: read the datasets, validate every row against
 * `@traffic/contracts`, resolve the region tree, and fail loudly on a broken reference.
 * With `--write` it upserts the validated catalog into the database idempotently.
 *
 * Validating here rather than at insert time is deliberate: a bad reference in seed data is
 * a typo somebody can fix in seconds, and finding it halfway through an insert leaves a
 * half-populated catalog nobody can describe.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contracts } from '@traffic/contracts'

const seedRoot = path.dirname(fileURLToPath(import.meta.url))

/** Every vertical the seed knows about. Adding a niche means adding a line here. */
export const verticalFiles = ['petroleum-wholesale.json']

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(seedRoot, relativePath), 'utf8'))
}

/**
 * Regions form a tree by `parent` code. Resolving it here catches a dangling parent before
 * anything touches the database, and returns the rows in insert order — parents first.
 */
export function resolveRegions(rows) {
  const byCode = new Map(rows.map((row) => [row.code, row]))
  const ordered = []
  const visiting = new Set()
  const placed = new Set()

  const place = (row, trail = []) => {
    if (placed.has(row.code)) return
    if (visiting.has(row.code)) {
      throw new Error(`Region cycle detected: ${[...trail, row.code].join(' -> ')}`)
    }
    visiting.add(row.code)

    if (row.parent !== null && row.parent !== undefined) {
      const parent = byCode.get(row.parent)
      if (!parent) {
        throw new Error(`Region "${row.code}" references unknown parent "${row.parent}"`)
      }
      place(parent, [...trail, row.code])
    }

    visiting.delete(row.code)
    placed.add(row.code)
    ordered.push(row)
  }

  for (const row of rows) place(row)
  return ordered
}

const regionKinds = contracts.catalog.regionKindSchema.options
const measurementUnits = contracts.catalog.measurementUnitSchema.options
const codePattern = /^[a-z][a-z0-9_]*$/
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function assert(condition, message) {
  if (!condition) throw new Error(`Seed validation failed: ${message}`)
}

/**
 * Validates the datasets against the contract vocabularies.
 *
 * The schemas in `@traffic/contracts` describe records that already have ids, timestamps and
 * a workspace; seed rows have none of those yet. So the shared vocabularies — region kinds,
 * measurement units, code and slug shapes — are the part that is checked, which is exactly
 * the part that can drift away from the contracts without anyone noticing.
 */
export function validateSeedData({ regions, verticals }) {
  assert(Array.isArray(regions) && regions.length > 0, 'regions must be a non-empty array')

  const regionCodes = new Set()
  for (const region of regions) {
    assert(codePattern.test(region.code), `region code "${region.code}" must be snake_case`)
    assert(!regionCodes.has(region.code), `duplicate region code "${region.code}"`)
    assert(regionKinds.includes(region.kind), `unknown region kind "${region.kind}"`)
    assert(typeof region.name === 'string' && region.name.length > 0, `region "${region.code}" needs a name`)
    regionCodes.add(region.code)
  }

  assert(verticals.length > 0, 'at least one vertical is required')

  const verticalCodes = new Set()
  const productSlugs = new Set()
  const categoryCodes = new Set()

  for (const dataset of verticals) {
    const { vertical, categories, deliveryBases } = dataset

    assert(codePattern.test(vertical.code), `vertical code "${vertical.code}" must be snake_case`)
    assert(!verticalCodes.has(vertical.code), `duplicate vertical code "${vertical.code}"`)
    verticalCodes.add(vertical.code)

    assert(Array.isArray(categories) && categories.length > 0, `vertical "${vertical.code}" needs categories`)

    for (const category of categories) {
      assert(codePattern.test(category.code), `category code "${category.code}" must be snake_case`)
      assert(slugPattern.test(category.slug), `category slug "${category.slug}" must be a slug`)
      assert(!categoryCodes.has(category.code), `duplicate category code "${category.code}"`)
      categoryCodes.add(category.code)

      assert(Array.isArray(category.products) && category.products.length > 0, `category "${category.code}" needs products`)

      for (const product of category.products) {
        assert(slugPattern.test(product.slug), `product slug "${product.slug}" must be a slug`)
        assert(!productSlugs.has(product.slug), `duplicate product slug "${product.slug}"`)
        assert(measurementUnits.includes(product.unit), `unknown unit "${product.unit}" on product "${product.slug}"`)
        assert(Array.isArray(product.synonyms), `product "${product.slug}" needs a synonyms array`)
        productSlugs.add(product.slug)

        // The factual policy, enforced rather than only documented. A specification field
        // appearing in seed data is how invented technical claims reach published content.
        for (const forbidden of ['specifications', 'spec', 'grade', 'standard', 'gost', 'price', 'density', 'sulphur', 'sulfur']) {
          assert(
            !(forbidden in product),
            `product "${product.slug}" carries "${forbidden}"; technical specifications, standards and prices are verified facts and never seed data (docs/PETROLEUM_TAXONOMY.md)`,
          )
        }
      }
    }

    for (const basis of deliveryBases ?? []) {
      assert(codePattern.test(basis.code), `delivery basis code "${basis.code}" must be snake_case`)
    }
  }

  return true
}

/** Loads every dataset and returns it validated and ordered, ready to insert. */
export async function loadSeedData() {
  const regionsFile = await readJson('data/regions.json')
  const verticals = []
  for (const file of verticalFiles) {
    verticals.push(await readJson(path.join('data/verticals', file)))
  }

  validateSeedData({ regions: regionsFile.regions, verticals })

  return {
    regions: resolveRegions(regionsFile.regions),
    verticals,
  }
}

/**
 * Writes the validated catalog to the database, idempotently.
 *
 * Everything is upserted by (workspace_id, code) — or (workspace_id, slug) for products —
 * so a re-run converges instead of duplicating. Regions are inserted in the order
 * `loadSeedData` returns: parents first, so a child can resolve its parent id in the same
 * pass. The first (and only, in the MVP) workspace is created by slug.
 */
export async function applySeed(db, { regions, verticals }) {
  const workspace = await db.workspace.upsert({
    where: { slug: 'pipupi' },
    update: { name: 'Pipupi' },
    create: { slug: 'pipupi', name: 'Pipupi', locale: 'ru' },
  })

  const regionIds = new Map()
  for (const row of regions) {
    const parentId = row.parent ? regionIds.get(row.parent) ?? null : null
    const region = await db.region.upsert({
      where: { workspaceId_code: { workspaceId: workspace.id, code: row.code } },
      update: { name: row.name, kind: row.kind, parentId },
      create: {
        workspaceId: workspace.id,
        code: row.code,
        name: row.name,
        kind: row.kind,
        parentId,
      },
    })
    regionIds.set(row.code, region.id)
  }

  for (const dataset of verticals) {
    const vertical = await db.vertical.upsert({
      where: { workspaceId_code: { workspaceId: workspace.id, code: dataset.vertical.code } },
      update: { name: dataset.vertical.name, description: dataset.vertical.description ?? null },
      create: {
        workspaceId: workspace.id,
        code: dataset.vertical.code,
        name: dataset.vertical.name,
        description: dataset.vertical.description ?? null,
      },
    })

    for (const category of dataset.categories) {
      const savedCategory = await db.productCategory.upsert({
        where: { workspaceId_code: { workspaceId: workspace.id, code: category.code } },
        update: {
          verticalId: vertical.id,
          name: category.name,
          slug: category.slug,
          position: category.position ?? 0,
        },
        create: {
          workspaceId: workspace.id,
          verticalId: vertical.id,
          code: category.code,
          name: category.name,
          slug: category.slug,
          position: category.position ?? 0,
        },
      })

      for (const product of category.products) {
        await db.product.upsert({
          where: { workspaceId_slug: { workspaceId: workspace.id, slug: product.slug } },
          update: {
            categoryId: savedCategory.id,
            name: product.name,
            unit: product.unit,
            synonyms: product.synonyms,
          },
          create: {
            workspaceId: workspace.id,
            categoryId: savedCategory.id,
            name: product.name,
            slug: product.slug,
            unit: product.unit,
            synonyms: product.synonyms,
          },
        })
      }
    }

    for (const basis of dataset.deliveryBases ?? []) {
      await db.deliveryBasis.upsert({
        where: { workspaceId_code: { workspaceId: workspace.id, code: basis.code } },
        update: { verticalId: vertical.id, name: basis.name, position: basis.position ?? 0 },
        create: {
          workspaceId: workspace.id,
          verticalId: vertical.id,
          code: basis.code,
          name: basis.name,
          position: basis.position ?? 0,
        },
      })
    }
  }

  return { workspaceId: workspace.id }
}

async function main() {
  const { regions, verticals } = await loadSeedData()
  const categories = verticals.flatMap((dataset) => dataset.categories)
  const products = categories.flatMap((category) => category.products)
  const deliveryBases = verticals.flatMap((dataset) => dataset.deliveryBases ?? [])

  console.log('Seed data is valid.')
  console.log(`  regions        : ${regions.length}`)
  console.log(`  verticals      : ${verticals.length} (${verticals.map((d) => d.vertical.code).join(', ')})`)
  console.log(`  categories     : ${categories.length}`)
  console.log(`  products       : ${products.length}`)
  console.log(`  delivery bases : ${deliveryBases.length}`)

  if (!process.argv.includes('--write')) {
    console.log('\nValidation only. Run with --write to upsert the catalog into DATABASE_URL.')
    return
  }

  // The generated client is imported lazily so the validation path keeps working in CI
  // before `prisma generate` has run.
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to write the seed')
  }
  const { createDb } = await import('../../src/db.ts')
  const db = createDb(databaseUrl)
  try {
    const result = await applySeed(db, { regions, verticals })
    console.log(`\nSeed applied. workspace: ${result.workspaceId}`)
  } finally {
    await db.$disconnect()
  }
}

if (import.meta.main) await main()
