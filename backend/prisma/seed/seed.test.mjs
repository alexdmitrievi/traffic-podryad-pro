/**
 * Tests for the catalog seed.
 *
 * Two things are asserted: the shipped data is valid, and the validator actually rejects the
 * shapes it claims to reject. The second half is what stops the validator from quietly
 * becoming a no-op — a loader that accepts everything looks exactly like one that works.
 */

import { describe, expect, test } from 'bun:test'
import { contracts } from '@traffic/contracts'
import { loadSeedData, resolveRegions, validateSeedData, verticalFiles } from './index.mjs'

const validVertical = () => ({
  vertical: { code: 'petroleum_wholesale', name: 'Нефтепродукты', description: null },
  categories: [
    {
      code: 'diesel_fuel',
      name: 'Дизельное топливо',
      slug: 'dizelnoe-toplivo',
      position: 10,
      products: [
        { name: 'Дизельное топливо', slug: 'dizelnoe-toplivo', unit: 'tonne', synonyms: ['ДТ'] },
      ],
    },
  ],
  deliveryBases: [{ code: 'pickup', name: 'Самовывоз', position: 10 }],
})

const validRegions = () => [
  { code: 'ru', name: 'Россия', kind: 'country', parent: null },
  { code: 'sfo', name: 'СФО', kind: 'federal_district', parent: 'ru' },
  { code: 'omsk', name: 'Омск', kind: 'city', parent: 'sfo' },
]

describe('the shipped seed data', () => {
  test('loads and validates', async () => {
    const { regions, verticals } = await loadSeedData()

    expect(regions.length).toBeGreaterThan(0)
    expect(verticals).toHaveLength(verticalFiles.length)
  })

  test('covers both initial federal districts and their cities', async () => {
    const { regions } = await loadSeedData()
    const codes = regions.map((region) => region.code)

    expect(codes).toContain('sfo')
    expect(codes).toContain('ufo')
    for (const city of ['omsk', 'novosibirsk', 'tyumen', 'yekaterinburg', 'chelyabinsk', 'kemerovo', 'krasnoyarsk', 'barnaul', 'irkutsk', 'kurgan']) {
      expect(codes).toContain(city)
    }
  })

  test('petroleum is one vertical among possible others, not the structure', async () => {
    const { verticals } = await loadSeedData()

    expect(verticals[0].vertical.code).toBe('petroleum_wholesale')
    // A second vertical is another file plus a line in verticalFiles: nothing about the
    // loader, the contracts or the schema names a fuel.
    expect(validateSeedData({
      regions: validRegions(),
      verticals: [
        validVertical(),
        {
          vertical: { code: 'commercial_real_estate', name: 'Коммерческая недвижимость' },
          categories: [
            {
              code: 'warehouses',
              name: 'Склады',
              slug: 'sklady',
              position: 10,
              products: [{ name: 'Складское помещение', slug: 'skladskoe-pomeshchenie', unit: 'piece', synonyms: [] }],
            },
          ],
          deliveryBases: [],
        },
      ],
    })).toBe(true)
  })

  test('covers the documented petroleum categories', async () => {
    const { verticals } = await loadSeedData()
    const codes = verticals[0].categories.map((category) => category.code)

    for (const expected of ['diesel_fuel', 'gasoline', 'fuel_oil', 'bitumen', 'lubricants', 'lpg', 'kerosene', 'heating_oil', 'marine_fuel']) {
      expect(codes).toContain(expected)
    }
  })

  test('carries no technical specification, standard or price anywhere', async () => {
    const { verticals } = await loadSeedData()
    const products = verticals.flatMap((dataset) => dataset.categories.flatMap((category) => category.products))

    for (const product of products) {
      expect(Object.keys(product).sort()).toEqual(['name', 'slug', 'synonyms', 'unit'])
    }
  })

  test('every unit and region kind comes from the contract vocabulary', async () => {
    const { regions, verticals } = await loadSeedData()

    for (const region of regions) {
      expect(contracts.catalog.regionKindSchema.safeParse(region.kind).success).toBe(true)
    }
    for (const dataset of verticals) {
      for (const category of dataset.categories) {
        for (const product of category.products) {
          expect(contracts.catalog.measurementUnitSchema.safeParse(product.unit).success).toBe(true)
        }
      }
    }
  })
})

describe('region tree resolution', () => {
  test('parents are ordered before their children', () => {
    const ordered = resolveRegions(validRegions()).map((region) => region.code)

    expect(ordered.indexOf('ru')).toBeLessThan(ordered.indexOf('sfo'))
    expect(ordered.indexOf('sfo')).toBeLessThan(ordered.indexOf('omsk'))
  })

  test('input order does not matter', () => {
    const reversed = [...validRegions()].reverse()
    const ordered = resolveRegions(reversed).map((region) => region.code)

    expect(ordered.indexOf('ru')).toBeLessThan(ordered.indexOf('omsk'))
  })

  test('a dangling parent is rejected', () => {
    expect(() =>
      resolveRegions([{ code: 'omsk', name: 'Омск', kind: 'city', parent: 'nowhere' }]),
    ).toThrow(/unknown parent/)
  })

  test('a cycle is rejected rather than looping forever', () => {
    expect(() =>
      resolveRegions([
        { code: 'a', name: 'A', kind: 'city', parent: 'b' },
        { code: 'b', name: 'B', kind: 'city', parent: 'a' },
      ]),
    ).toThrow(/cycle/)
  })
})

describe('the validator rejects what it claims to reject', () => {
  const cases = [
    {
      name: 'a product carrying a specification',
      mutate: (dataset) => {
        dataset.categories[0].products[0].specifications = 'ГОСТ 305-2013'
        return dataset
      },
      expected: /specifications/,
    },
    {
      name: 'a product carrying a grade',
      mutate: (dataset) => {
        dataset.categories[0].products[0].grade = 'ДТ-Л-К5'
        return dataset
      },
      expected: /grade/,
    },
    {
      name: 'a product carrying a price',
      mutate: (dataset) => {
        dataset.categories[0].products[0].price = 62000
        return dataset
      },
      expected: /price/,
    },
    {
      name: 'a product carrying a standard reference',
      mutate: (dataset) => {
        dataset.categories[0].products[0].gost = '305-2013'
        return dataset
      },
      expected: /gost/,
    },
    {
      name: 'an unknown unit',
      mutate: (dataset) => {
        dataset.categories[0].products[0].unit = 'barrel'
        return dataset
      },
      expected: /unknown unit/,
    },
    {
      name: 'a non-snake_case vertical code',
      mutate: (dataset) => {
        dataset.vertical.code = 'Petroleum Wholesale'
        return dataset
      },
      expected: /snake_case/,
    },
    {
      name: 'a non-slug product slug',
      mutate: (dataset) => {
        dataset.categories[0].products[0].slug = 'Дизельное Топливо'
        return dataset
      },
      expected: /must be a slug/,
    },
    {
      name: 'a category without products',
      mutate: (dataset) => {
        dataset.categories[0].products = []
        return dataset
      },
      expected: /needs products/,
    },
  ]

  for (const item of cases) {
    test(`rejects ${item.name}`, () => {
      const dataset = item.mutate(validVertical())

      expect(() => validateSeedData({ regions: validRegions(), verticals: [dataset] })).toThrow(
        item.expected,
      )
    })
  }

  test('rejects duplicate product slugs across categories', () => {
    const dataset = validVertical()
    dataset.categories.push({
      code: 'gasoline',
      name: 'Бензины',
      slug: 'benziny',
      position: 20,
      products: [{ name: 'Другое', slug: 'dizelnoe-toplivo', unit: 'tonne', synonyms: [] }],
    })

    expect(() => validateSeedData({ regions: validRegions(), verticals: [dataset] })).toThrow(
      /duplicate product slug/,
    )
  })

  test('rejects an unknown region kind', () => {
    const regions = [{ code: 'ru', name: 'Россия', kind: 'planet', parent: null }]

    expect(() => validateSeedData({ regions, verticals: [validVertical()] })).toThrow(
      /unknown region kind/,
    )
  })

  test('rejects an empty region set', () => {
    expect(() => validateSeedData({ regions: [], verticals: [validVertical()] })).toThrow(
      /non-empty/,
    )
  })

  test('a healthy dataset passes, so the rejections above mean something', () => {
    expect(validateSeedData({ regions: validRegions(), verticals: [validVertical()] })).toBe(true)
  })
})
