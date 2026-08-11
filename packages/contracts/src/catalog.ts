import { z } from 'zod'
import { idSchema, isoDateTimeSchema, shortTextSchema, slugSchema, workspaceIdSchema } from './common'

/**
 * The catalog: a generic taxonomy of what a workspace sells.
 *
 * Pipupi is a marketing product, not a petroleum service. Wholesale petroleum distribution
 * across the Siberian and Ural federal districts is the first workspace we validate on — a
 * row in `verticals`, not a shape baked into these types. Nothing below names a fuel, a
 * grade or a delivery term: a second vertical is seed data plus a workspace, never a schema
 * change.
 *
 * The petroleum taxonomy itself lives in backend/prisma/seed/data and is documented in
 * docs/PETROLEUM_TAXONOMY.md, including the rule that technical specifications, standards and
 * prices are never invented.
 */

// ── Verticals ────────────────────────────────────────────────────────────────

export const verticalSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  /** Stable machine name, e.g. the first one is `petroleum_wholesale`. */
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'vertical code must be lowercase snake_case'),
  name: shortTextSchema,
  description: z.string().trim().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
})

// ── Regions ──────────────────────────────────────────────────────────────────

/**
 * Regions form a tree. The MVP seeds federal districts and the cities we sell into, and
 * fills in the subject level only when a real keyword asks for it: importing a full
 * administrative directory up front produces hundreds of rows nothing ever references.
 */
export const regionKindSchema = z.enum(['country', 'federal_district', 'subject', 'city'])

export const regionSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'region code must be lowercase snake_case'),
  name: shortTextSchema,
  kind: regionKindSchema,
  parentId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
})

// ── Units and products ───────────────────────────────────────────────────────

/** Units of sale. Open enough for a second vertical without becoming a physics library. */
export const measurementUnitSchema = z.enum(['tonne', 'litre', 'cubic_metre', 'kilogram', 'piece'])

export const productCategorySchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  verticalId: idSchema,
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'category code must be lowercase snake_case'),
  name: shortTextSchema,
  slug: slugSchema,
  position: z.int().min(0).default(0),
  createdAt: isoDateTimeSchema,
})

export const productSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  categoryId: idSchema,
  name: shortTextSchema,
  slug: slugSchema,
  unit: measurementUnitSchema,
  /**
   * Alternative spellings and colloquial forms. Used to attach imported keywords to a
   * product automatically; not shown to users.
   */
  synonyms: z.array(z.string().trim().min(1).max(120)).max(64).default([]),
  /**
   * Deliberately absent: technical specifications, grades, standards, temperature ranges and
   * prices. Those are facts a person verifies against a source before publication, and a
   * field here would invite a model to fill it. See docs/PETROLEUM_TAXONOMY.md.
   */
  createdAt: isoDateTimeSchema,
})

/**
 * How the goods change hands. Values are workspace data, not an enum: the list differs per
 * vertical, and a fixed enum would make the first non-petroleum workspace a schema change.
 * This is a picker in a form and carries no contractual meaning — the contract does.
 */
export const deliveryBasisSchema = z.object({
  id: idSchema,
  workspaceId: workspaceIdSchema,
  verticalId: idSchema,
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'delivery basis code must be lowercase snake_case'),
  name: shortTextSchema,
  position: z.int().min(0).default(0),
})

export const catalogSnapshotSchema = z.object({
  verticals: z.array(verticalSchema),
  regions: z.array(regionSchema),
  categories: z.array(productCategorySchema),
  products: z.array(productSchema),
  deliveryBases: z.array(deliveryBasisSchema),
})

export type Vertical = z.infer<typeof verticalSchema>
export type RegionKind = z.infer<typeof regionKindSchema>
export type Region = z.infer<typeof regionSchema>
export type MeasurementUnit = z.infer<typeof measurementUnitSchema>
export type ProductCategory = z.infer<typeof productCategorySchema>
export type Product = z.infer<typeof productSchema>
export type DeliveryBasis = z.infer<typeof deliveryBasisSchema>
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>
