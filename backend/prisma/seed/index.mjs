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
 * Writing to the database arrives in Wave 4 together with Prisma Client — see `applySeed`
 * at the bottom for the exact shape that step will take.
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
 * Wave 4. The write is intentionally not implemented yet: it needs Prisma Client, a running
 * database and migrations, none of which exist in this wave. The shape is fixed though —
 * insert regions in the order `loadSeedData` returns them, then each vertical with its
 * categories, products and delivery bases, all upserted by (workspace_id, code) so a re-run
 * is idempotent.
 */
export async function applySeed() {
  throw new Error(
    'applySeed is implemented in Wave 4, once Prisma Client and migrations exist. Use loadSeedData() to inspect the dataset.',
  )
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
  console.log('\nWriting to the database arrives in Wave 4 (applySeed).')
}

if (import.meta.main) await main()
