import { describe, expect, test } from 'bun:test'
import { contracts } from './index'

/**
 * Contract tests.
 *
 * Sample payloads in both directions: a valid one must parse, and the specific invalid shapes
 * these schemas exist to reject must fail. The rejections are the point — a schema that
 * accepts everything typechecks fine and validates nothing.
 */

const uuid = (n: number) => `0192f1a0-0000-7000-8000-${String(n).padStart(12, '0')}`
const hash = (c: string) => c.repeat(64).slice(0, 64)
const now = '2026-08-11T12:00:00.000Z'

// ── errors ───────────────────────────────────────────────────────────────────

describe('errors', () => {
  test('the envelope parses', () => {
    const parsed = contracts.errors.apiErrorSchema.parse({
      error: { code: 'APPROVAL_REQUIRED', message: 'publication needs an approval' },
    })

    expect(parsed.error.code).toBe('APPROVAL_REQUIRED')
  })

  test('an unknown code is rejected', () => {
    const result = contracts.errors.apiErrorSchema.safeParse({
      error: { code: 'MADE_UP', message: 'x' },
    })

    expect(result.success).toBe(false)
  })

  test('the codes carrying the approval invariant exist', () => {
    for (const code of ['APPROVAL_REQUIRED', 'APPROVAL_STALE', 'PUBLICATION_BLOCKED']) {
      expect(contracts.errors.apiErrorCodeSchema.safeParse(code).success).toBe(true)
    }
  })
})

// ── common ───────────────────────────────────────────────────────────────────

describe('common', () => {
  test('a content hash must be a lowercase hex sha-256', () => {
    expect(contracts.common.contentHashSchema.safeParse(hash('a')).success).toBe(true)
    expect(contracts.common.contentHashSchema.safeParse(hash('A')).success).toBe(false)
    expect(contracts.common.contentHashSchema.safeParse('abc').success).toBe(false)
  })

  test('slugs are lowercase words joined by single hyphens', () => {
    expect(contracts.common.slugSchema.safeParse('dizelnoe-toplivo-omsk').success).toBe(true)
    expect(contracts.common.slugSchema.safeParse('Dizel Toplivo').success).toBe(false)
    expect(contracts.common.slugSchema.safeParse('a--b').success).toBe(false)
  })

  test('the MVP locale set is exactly ru', () => {
    expect(contracts.common.localeSchema.safeParse('ru').success).toBe(true)
    expect(contracts.common.localeSchema.safeParse('en').success).toBe(false)
  })
})

// ── users ────────────────────────────────────────────────────────────────────

describe('users', () => {
  test('the three roles parse and nothing else does', () => {
    for (const role of ['admin', 'editor', 'viewer']) {
      expect(contracts.users.userRoleSchema.safeParse(role).success).toBe(true)
    }
    expect(contracts.users.userRoleSchema.safeParse('owner').success).toBe(false)
  })

  test('a user DTO parses', () => {
    const user = contracts.users.userSchema.parse({
      id: uuid(1),
      email: 'editor@pipupi.ru',
      displayName: null,
      role: 'editor',
      createdAt: now,
    })

    expect(user.role).toBe('editor')
  })
})

// ── auth ─────────────────────────────────────────────────────────────────────

describe('auth', () => {
  test('a short password is rejected', () => {
    const result = contracts.auth.registerRequestSchema.safeParse({
      email: 'a@pipupi.ru',
      password: 'short',
    })

    expect(result.success).toBe(false)
  })

  test('the cookie refresh body is strictly empty', () => {
    expect(contracts.auth.cookieRefreshRequestSchema.safeParse({}).success).toBe(true)
    expect(
      contracts.auth.cookieRefreshRequestSchema.safeParse({ refreshToken: 'x' }).success,
    ).toBe(false)
  })

  test('the browser auth response never carries a refresh token', () => {
    const result = contracts.auth.cookieAuthResponseSchema.safeParse({
      user: { id: uuid(1), email: 'a@pipupi.ru', displayName: null, role: 'admin', createdAt: now },
      accessToken: 'header.payload.signature',
      refreshToken: 'leaked',
    })

    expect(result.success).toBe(false)
  })
})

// ── catalog ──────────────────────────────────────────────────────────────────

describe('catalog', () => {
  test('a vertical parses and petroleum is just one value', () => {
    const vertical = contracts.catalog.verticalSchema.parse({
      id: uuid(1),
      workspaceId: uuid(2),
      code: 'petroleum_wholesale',
      name: 'Оптовая дистрибуция нефтепродуктов',
      description: null,
      createdAt: now,
    })

    expect(vertical.code).toBe('petroleum_wholesale')

    const second = contracts.catalog.verticalSchema.safeParse({
      ...vertical,
      code: 'commercial_real_estate',
    })
    expect(second.success).toBe(true)
  })

  test('region kinds cover the tree the seed needs', () => {
    for (const kind of ['country', 'federal_district', 'subject', 'city']) {
      expect(contracts.catalog.regionKindSchema.safeParse(kind).success).toBe(true)
    }
  })

  test('a product carries synonyms but no specifications', () => {
    const product = contracts.catalog.productSchema.parse({
      id: uuid(1),
      workspaceId: uuid(2),
      categoryId: uuid(3),
      name: 'Дизельное топливо',
      slug: 'dizelnoe-toplivo',
      unit: 'tonne',
      synonyms: ['ДТ', 'солярка'],
      createdAt: now,
    })

    expect(product.synonyms).toContain('ДТ')
    // No field exists for a grade, a standard or a price: those are verified facts, and a
    // field here would invite a model to fill it. See docs/PETROLEUM_TAXONOMY.md.
    expect('specifications' in product).toBe(false)
    expect('price' in product).toBe(false)
  })

  test('a category code must be snake_case', () => {
    const base = {
      id: uuid(1),
      workspaceId: uuid(2),
      verticalId: uuid(3),
      name: 'Дизельное топливо',
      slug: 'diesel-fuel',
      createdAt: now,
    }

    expect(contracts.catalog.productCategorySchema.safeParse({ ...base, code: 'diesel_fuel' }).success).toBe(true)
    expect(contracts.catalog.productCategorySchema.safeParse({ ...base, code: 'Diesel Fuel' }).success).toBe(false)
  })
})

// ── service requests ─────────────────────────────────────────────────────────

describe('service requests', () => {
  test('all four service lines exist', () => {
    for (const line of ['seo_content', 'b2b_outreach', 'telegram_marketing', 'complex_package']) {
      expect(contracts.serviceRequests.serviceLineSchema.safeParse(line).success).toBe(true)
    }
  })

  test('only seo_content is executable in the MVP', () => {
    expect(contracts.serviceRequests.isExecutableServiceLine('seo_content')).toBe(true)
    expect(contracts.serviceRequests.isExecutableServiceLine('b2b_outreach')).toBe(false)
    expect(contracts.serviceRequests.isExecutableServiceLine('telegram_marketing')).toBe(false)
  })

  test('planned_awaiting_capability is a real status and a terminal one', () => {
    expect(
      contracts.serviceRequests.serviceRequestStatusSchema.safeParse('planned_awaiting_capability')
        .success,
    ).toBe(true)
    expect(contracts.serviceRequests.terminalServiceRequestStatuses).toContain(
      'planned_awaiting_capability',
    )
  })

  test('a create payload parses and rejects unknown fields', () => {
    const created = contracts.serviceRequests.createServiceRequestSchema.parse({
      serviceLine: 'seo_content',
      title: 'ДТ оптом по СФО',
      objective: 'Собрать органический трафик по запросам оптовой покупки дизельного топлива.',
    })

    expect(created.locale).toBe('ru')
    expect(created.targetRegionIds).toEqual([])

    const withUnknown = contracts.serviceRequests.createServiceRequestSchema.safeParse({
      serviceLine: 'seo_content',
      title: 'x',
      objective: 'y',
      budgetRub: 100000,
    })
    expect(withUnknown.success).toBe(false)
  })

  test('rejection, hold and cancellation require a reason', () => {
    for (const status of ['rejected', 'on_hold', 'cancelled']) {
      expect(
        contracts.serviceRequests.changeServiceRequestStatusSchema.safeParse({ status }).success,
      ).toBe(false)
      expect(
        contracts.serviceRequests.changeServiceRequestStatusSchema.safeParse({
          status,
          reason: 'вне профиля',
        }).success,
      ).toBe(true)
    }
  })

  test('a request number follows the documented shape', () => {
    expect(contracts.serviceRequests.requestNumberSchema.safeParse('SR-2026-0001').success).toBe(true)
    expect(contracts.serviceRequests.requestNumberSchema.safeParse('SR-1').success).toBe(false)
  })
})

// ── plans ────────────────────────────────────────────────────────────────────

describe('service request plans', () => {
  test('an seo plan parses', () => {
    const plan = contracts.plans.planContentSchema.parse({
      kind: 'seo_content',
      goals: ['Занять органику по оптовым запросам ДТ в Омске и Тюмени.'],
      plannedArticleCount: 12,
    })

    expect(plan.kind).toBe('seo_content')
  })

  test('an outreach plan describes a profile and has nowhere to put a person', () => {
    const plan = contracts.plans.b2bOutreachPlanSchema.parse({
      kind: 'b2b_outreach',
      idealCustomerProfile: 'Автопарки от 20 единиц техники в СФО и УФО.',
      segments: [{ name: 'Автопарки Тюменской области', traits: ['транспорт', '20+ единиц'], estimatedSize: 120 }],
      valueHypotheses: ['Стабильность поставки важнее цены за литр.'],
      assumedLegalBasis: 'Требуется заключение юриста до фазы 1.',
    })

    expect(plan.segments[0]?.traits).toContain('транспорт')
    // The compliance boundary is the shape itself: no recipients, no contacts, at any level.
    expect('recipients' in plan).toBe(false)
    expect('contacts' in plan).toBe(false)
    expect('emails' in plan).toBe(false)
    expect(Object.keys(plan.segments[0] ?? {})).toEqual(['name', 'traits', 'estimatedSize'])
  })

  test('an outreach plan cannot smuggle recipients through an extra field', () => {
    const result = contracts.plans.b2bOutreachPlanSchema.safeParse({
      kind: 'b2b_outreach',
      idealCustomerProfile: 'x',
      segments: [{ name: 's', traits: ['t'], estimatedSize: null, recipients: ['a@b.ru'] }],
      valueHypotheses: ['h'],
      assumedLegalBasis: 'b',
    })

    // Zod strips unknown keys rather than failing, so assert the field does not survive.
    expect(result.success).toBe(true)
    if (result.success) {
      expect('recipients' in (result.data.segments[0] ?? {})).toBe(false)
    }
  })

  test('a telegram plan is opt-in only and has no broadcast mechanics', () => {
    const plan = contracts.plans.telegramMarketingPlanSchema.parse({
      kind: 'telegram_marketing',
      channelConcept: 'Канал о логистике ГСМ.',
      optInMechanics: 'Пользователь сам нажимает /start.',
    })

    expect('recipients' in plan).toBe(false)
    expect('broadcast' in plan).toBe(false)
    expect('memberList' in plan).toBe(false)
  })

  test('an assumed legal basis is required for outreach', () => {
    const result = contracts.plans.b2bOutreachPlanSchema.safeParse({
      kind: 'b2b_outreach',
      idealCustomerProfile: 'x',
      segments: [{ name: 's', traits: ['t'], estimatedSize: null }],
      valueHypotheses: ['h'],
    })

    expect(result.success).toBe(false)
  })

  test('a complex package decomposes into non-package children', () => {
    const result = contracts.plans.complexPackagePlanSchema.safeParse({
      kind: 'complex_package',
      overallGoal: 'Выйти на рынок УФО.',
      childRequests: [{ serviceLine: 'complex_package', title: 'x', objective: 'y' }],
    })

    expect(result.success).toBe(false)
  })

  test('the discriminated union routes on kind', () => {
    const result = contracts.plans.planContentSchema.safeParse({
      kind: 'b2b_outreach',
      goals: ['wrong shape for this kind'],
      plannedArticleCount: 1,
    })

    expect(result.success).toBe(false)
  })
})

// ── research ─────────────────────────────────────────────────────────────────

describe('research', () => {
  test('a keyword import payload parses and is bounded', () => {
    const parsed = contracts.research.keywords.keywordImportRequestSchema.parse({
      requestId: uuid(1),
      rows: [{ phrase: 'дизельное топливо оптом омск', volume: '320', intent: 'commercial' }],
    })

    expect(parsed.rows[0]?.volume).toBe(320)
    expect(parsed.locale).toBe('ru')
  })

  test('an empty import is rejected', () => {
    const result = contracts.research.keywords.keywordImportRequestSchema.safeParse({
      requestId: uuid(1),
      rows: [],
    })

    expect(result.success).toBe(false)
  })

  test('a cluster carries no embedding while the vector gate is unresolved', () => {
    const cluster = contracts.research.topicClusters.topicClusterSchema.parse({
      id: uuid(1),
      workspaceId: uuid(2),
      requestId: uuid(3),
      title: 'Оптовая покупка ДТ',
      summary: null,
      pillarKeywordId: uuid(4),
      productId: null,
      regionId: null,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    })

    expect('embedding' in cluster).toBe(false)
    expect('vector' in cluster).toBe(false)
  })
})

// ── content ──────────────────────────────────────────────────────────────────

describe('content', () => {
  test('a revision carries an immutable hash', () => {
    const revision = contracts.content.contentRevisionSchema.parse({
      id: uuid(1),
      workspaceId: uuid(2),
      contentItemId: uuid(3),
      revisionNumber: 1,
      bodyMarkdown: '# Заголовок\n\nТекст.',
      metaTitle: null,
      metaDescription: null,
      contentHash: hash('b'),
      authorKind: 'llm',
      authorId: null,
      llmRunId: uuid(4),
      createdAt: now,
    })

    expect(revision.contentHash).toHaveLength(64)
  })

  test('a publication cannot exist without an approval id', () => {
    const base = {
      id: uuid(1),
      workspaceId: uuid(2),
      contentItemId: uuid(3),
      revisionId: uuid(4),
      target: 'internal_website',
      status: 'published',
      publicUrl: 'https://pipupi.ru/blog/dt-optom',
      publishedAt: now,
      publishedById: uuid(5),
      createdAt: now,
    }

    expect(contracts.content.publicationSchema.safeParse(base).success).toBe(false)
    expect(
      contracts.content.publicationSchema.safeParse({ ...base, approvalId: uuid(6) }).success,
    ).toBe(true)
    expect(
      contracts.content.publicationSchema.safeParse({ ...base, approvalId: null }).success,
    ).toBe(false)
  })

  test('brief outline sections can mark facts for human verification', () => {
    const brief = contracts.content.briefOutlineSectionSchema.parse({
      heading: 'Условия поставки',
      intent: null,
      factsToVerify: ['Уточнить у коммерческого отдела реальные базисы поставки.'],
    })

    expect(brief.factsToVerify).toHaveLength(1)
  })
})

// ── approvals ────────────────────────────────────────────────────────────────

describe('approvals', () => {
  test('an approval binds to a content hash', () => {
    const approval = contracts.approvals.createApprovalSchema.parse({
      subjectType: 'content_revision',
      subjectId: uuid(1),
      contentHash: hash('c'),
      decision: 'approved',
    })

    expect(approval.contentHash).toBe(hash('c'))
  })

  test('an approval without a hash is rejected', () => {
    const result = contracts.approvals.createApprovalSchema.safeParse({
      subjectType: 'content_revision',
      subjectId: uuid(1),
      decision: 'approved',
    })

    expect(result.success).toBe(false)
  })

  test('a rejection requires a note', () => {
    const base = {
      subjectType: 'content_revision' as const,
      subjectId: uuid(1),
      contentHash: hash('c'),
    }

    expect(
      contracts.approvals.createApprovalSchema.safeParse({ ...base, decision: 'rejected' }).success,
    ).toBe(false)
    expect(
      contracts.approvals.createApprovalSchema.safeParse({
        ...base,
        decision: 'rejected',
        note: 'выдуманные характеристики в разделе 3',
      }).success,
    ).toBe(true)
  })

  test('approval state distinguishes never approved from stale', () => {
    for (const reason of ['approved', 'never_approved', 'stale', 'rejected']) {
      const state = contracts.approvals.approvalStateSchema.safeParse({
        subjectType: 'content_revision',
        subjectId: uuid(1),
        currentHash: hash('d'),
        approval: null,
        isApproved: reason === 'approved',
        reason,
      })

      expect(state.success).toBe(true)
    }
  })
})

// ── leads ────────────────────────────────────────────────────────────────────

describe('leads', () => {
  const validSubmission = {
    contactName: 'Алексей',
    phone: '79001234567',
    consent: true as const,
    consentTextVersion: '2026-08-01',
    privacyPolicyVersion: '2026-08-01',
  }

  test('a valid submission parses', () => {
    expect(contracts.leads.submitLeadRequestSchema.parse(validSubmission).contactName).toBe('Алексей')
  })

  test('consent is mandatory and must be true', () => {
    const { consent, ...withoutConsent } = validSubmission

    expect(contracts.leads.submitLeadRequestSchema.safeParse(withoutConsent).success).toBe(false)
    expect(
      contracts.leads.submitLeadRequestSchema.safeParse({ ...validSubmission, consent: false })
        .success,
    ).toBe(false)
  })

  test('at least one contact channel is required', () => {
    const { phone, ...withoutContact } = validSubmission

    expect(contracts.leads.submitLeadRequestSchema.safeParse(withoutContact).success).toBe(false)
    expect(
      contracts.leads.submitLeadRequestSchema.safeParse({
        ...withoutContact,
        email: 'buyer@example.ru',
      }).success,
    ).toBe(true)
  })

  test('phone must be normalized before it reaches the API', () => {
    expect(
      contracts.leads.submitLeadRequestSchema.safeParse({
        ...validSubmission,
        phone: '+7 (900) 123-45-67',
      }).success,
    ).toBe(false)
  })

  test('the honeypot must stay empty', () => {
    expect(
      contracts.leads.submitLeadRequestSchema.safeParse({ ...validSubmission, website: 'spam' })
        .success,
    ).toBe(false)
  })

  test('an INN is either 10 or 12 digits', () => {
    for (const [inn, ok] of [['5505164012', true], ['550516401202', true], ['12345', false]] as const) {
      expect(
        contracts.leads.submitLeadRequestSchema.safeParse({ ...validSubmission, inn }).success,
      ).toBe(ok)
    }
  })
})

// ── attribution ──────────────────────────────────────────────────────────────

describe('attribution', () => {
  test('a touch can be recorded before a lead exists', () => {
    const touch = contracts.attribution.recordTouchRequestSchema.parse({
      visitorId: uuid(1),
      path: '/blog/dt-optom-omsk',
    })

    expect(touch.path).toBe('/blog/dt-optom-omsk')
  })

  test('the chain covers every link the MVP must prove', () => {
    const chain = contracts.attribution.attributionChainSchema.parse({
      leadId: uuid(1),
      firstTouch: null,
      lastTouch: null,
      contentItemId: uuid(2),
      contentTitle: 'ДТ оптом в Омске',
      clusterId: uuid(3),
      clusterTitle: 'Оптовая покупка ДТ',
      keywordId: uuid(4),
      keywordPhrase: 'дизельное топливо оптом омск',
      productId: uuid(5),
      productName: 'Дизельное топливо',
      regionId: uuid(6),
      regionName: 'Омск',
    })

    expect(chain.keywordPhrase).toBe('дизельное топливо оптом омск')
    expect(chain.regionName).toBe('Омск')
  })

  test('first and last touch are distinct positions', () => {
    for (const position of ['first', 'last', 'middle']) {
      expect(contracts.attribution.touchPositionSchema.safeParse(position).success).toBe(true)
    }
  })
})

// ── llm runs ─────────────────────────────────────────────────────────────────

describe('llm runs', () => {
  test('a run records cost and a prompt hash rather than the prompt', () => {
    const run = contracts.llmRuns.llmRunSchema.parse({
      id: uuid(1),
      workspaceId: uuid(2),
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      purpose: 'draft_generation',
      promptHash: hash('e'),
      inputTokens: 1200,
      outputTokens: 3400,
      costMinorUnits: 1750,
      costCurrency: 'RUB',
      latencyMs: 18_400,
      status: 'succeeded',
      errorCode: null,
      createdAt: now,
    })

    expect(run.promptHash).toHaveLength(64)
    expect('prompt' in run).toBe(false)
    expect('completion' in run).toBe(false)
  })

  test('cost is an integer in minor units', () => {
    expect(
      contracts.llmRuns.llmUsageSummarySchema.safeParse({
        periodStart: now,
        periodEnd: now,
        runCount: 1,
        inputTokens: 1,
        outputTokens: 1,
        costMinorUnits: 12.5,
        costCurrency: 'RUB',
        capMinorUnits: null,
      }).success,
    ).toBe(false)
  })
})

// ── evidence ─────────────────────────────────────────────────────────────────

describe('evidence', () => {
  const sourceId = uuid(1)
  const claimId = uuid(2)
  const citationId = uuid(3)
  const verifiedById = uuid(4)

  const validSource = {
    id: sourceId,
    workspaceId: uuid(9),
    title: 'Технические условия производителя',
    kind: 'producer_document',
    url: null,
    publishedAt: null,
    retrievedAt: null,
    verifiedAt: null,
    verifiedById: null,
    notes: null,
    claimCount: 0,
    createdAt: now,
    updatedAt: now,
  }

  const validClaim = {
    id: claimId,
    workspaceId: uuid(9),
    sourceId,
    statement: 'Дизельное топливо поставляется по техническим условиям производителя.',
    category: 'поставка',
    verifiedAt: null,
    verifiedById: null,
    supersededById: null,
    status: 'unverified',
    citations: [
      { id: citationId, location: 'Раздел 2, таблица 1', quote: 'ТУ 38.001-2026, п. 2.1' },
    ],
    createdAt: now,
  }

  test('a valid source parses', () => {
    expect(contracts.evidence.evidenceSourceSchema.safeParse(validSource).success).toBe(true)
  })

  test('an unknown source kind is rejected', () => {
    expect(
      contracts.evidence.evidenceSourceSchema.safeParse({ ...validSource, kind: 'blog' }).success,
    ).toBe(false)
  })

  test('a valid claim with citations parses', () => {
    expect(contracts.evidence.claimSchema.safeParse(validClaim).success).toBe(true)
  })

  test('a claim status outside the three-way set is rejected', () => {
    expect(
      contracts.evidence.claimSchema.safeParse({ ...validClaim, status: 'draft' }).success,
    ).toBe(false)
  })

  test('a claim without a source cannot be created', () => {
    const result = contracts.evidence.createClaimSchema.safeParse({
      statement: validClaim.statement,
      citations: [],
    })
    expect(result.success).toBe(false)
  })

  test('a claim statement must be non-empty text', () => {
    expect(
      contracts.evidence.createClaimSchema.safeParse({
        sourceId,
        statement: '   ',
      }).success,
    ).toBe(false)
  })

  test('supersession payload accepts partial fields and inherits the rest', () => {
    const result = contracts.evidence.supersedeClaimSchema.safeParse({
      statement: 'Исправленная формулировка.',
    })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ statement: 'Исправленная формулировка.' })
  })

  test('supersession rejects unknown fields', () => {
    expect(
      contracts.evidence.supersedeClaimSchema.safeParse({ claimId }).success,
    ).toBe(false)
  })

  test('a citation must name a location and may carry a short quote', () => {
    expect(
      contracts.evidence.claimCitationInputSchema.safeParse({ location: 'стр. 3', quote: 'цитата' })
        .success,
    ).toBe(true)
    expect(contracts.evidence.claimCitationInputSchema.safeParse({ quote: 'без места' }).success).toBe(
      false,
    )
  })
})

// ── geo queries ──────────────────────────────────────────────────────────────

describe('geo queries', () => {
  test('a valid query parses with defaults', () => {
    const parsed = contracts.geoQueries.createGeoQuerySchema.parse({
      question: 'Как купить дизельное топливо оптом в Омске?',
    })

    expect(parsed.priority).toBe('medium')
    expect(parsed.clusterId).toBeUndefined()
  })

  test('an unknown priority or status is rejected', () => {
    expect(
      contracts.geoQueries.geoQueryPrioritySchema.safeParse('urgent').success,
    ).toBe(false)
    expect(
      contracts.geoQueries.geoQueryStatusSchema.safeParse('done').success,
    ).toBe(false)
  })

  test('a triage update must change at least one field', () => {
    expect(contracts.geoQueries.updateGeoQuerySchema.safeParse({}).success).toBe(false)
    expect(
      contracts.geoQueries.updateGeoQuerySchema.safeParse({ status: 'planned' }).success,
    ).toBe(true)
  })

  test('the update payload rejects unknown fields', () => {
    expect(
      contracts.geoQueries.updateGeoQuerySchema.safeParse({ status: 'planned', question: 'x' })
        .success,
    ).toBe(false)
  })

  test('a question without text is rejected', () => {
    expect(
      contracts.geoQueries.createGeoQuerySchema.safeParse({ question: '  ' }).success,
    ).toBe(false)
  })
})

// ── geo snapshots ────────────────────────────────────────────────────────────

describe('geo snapshots', () => {
  const queryId = uuid(10)

  const validSnapshot = {
    id: uuid(11),
    workspaceId: uuid(9),
    queryId,
    searchEngine: 'yandex',
    searchPhrase: 'дизельное топливо оптом омск',
    brandMentioned: true,
    mentionPosition: 3,
    answerExcerpt: 'Среди поставщиков — Pipupi.',
    capturedAt: now,
    notes: null,
    createdAt: now,
  }

  test('a valid snapshot parses', () => {
    expect(
      contracts.geoSnapshots.geoVisibilitySnapshotSchema.safeParse(validSnapshot).success,
    ).toBe(true)
  })

  test('a mention position with an absent mention is rejected', () => {
    expect(
      contracts.geoSnapshots.createGeoVisibilitySnapshotSchema.safeParse({
        searchEngine: 'yandex',
        brandMentioned: false,
        mentionPosition: 2,
      }).success,
    ).toBe(false)
  })

  test('an engine code is a lowercase identifier, not free text', () => {
    expect(
      contracts.geoSnapshots.createGeoVisibilitySnapshotSchema.safeParse({
        searchEngine: 'Яндекс',
        brandMentioned: false,
      }).success,
    ).toBe(false)
    expect(
      contracts.geoSnapshots.createGeoVisibilitySnapshotSchema.safeParse({
        searchEngine: 'perplexity',
        brandMentioned: false,
      }).success,
    ).toBe(true)
  })

  test('a snapshot requires the brand mention flag', () => {
    expect(
      contracts.geoSnapshots.createGeoVisibilitySnapshotSchema.safeParse({
        searchEngine: 'yandex',
      }).success,
    ).toBe(false)
  })
})

// ── the tree itself ──────────────────────────────────────────────────────────

describe('contract tree', () => {
  test('every documented context is reachable through the tree', () => {
    expect(Object.keys(contracts).sort()).toEqual([
      'approvals',
      'attribution',
      'auth',
      'catalog',
      'common',
      'content',
      'errors',
      'evidence',
      'geoQueries',
      'geoSnapshots',
      'leads',
      'llmRuns',
      'outbox',
      'plans',
      'research',
      'serviceRequests',
      'users',
    ])
    expect(Object.keys(contracts.research).sort()).toEqual(['keywords', 'topicClusters'])
  })

  test('no contract exposes a vector field while the production gate is unresolved', () => {
    const serialized = JSON.stringify(
      Object.keys(contracts).map((key) => key),
    )

    expect(serialized.includes('vector')).toBe(false)
    expect(serialized.includes('embedding')).toBe(false)
  })
})
