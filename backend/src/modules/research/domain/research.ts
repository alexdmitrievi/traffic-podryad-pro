/**
 * Pure research rules: keyword normalization, intent classification and the lexical
 * clustering strategy chosen for the MVP (docs/WAVE_4_DELEGATION.md section 6: cosine
 * similarity in memory, cluster membership in the database; the embeddings source stays
 * undecided until the production pgvector gate closes, so the first slice clusters on
 * lexical overlap).
 */

import type { KeywordIntent } from '@traffic/contracts'

// ── Normalization ─────────────────────────────────────────────────────────────

const layoutMap: Record<string, string> = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
  '[': 'х', ']': 'ъ', a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о',
  k: 'л', l: 'д', ';': 'ж', "'": 'э', z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и',
  n: 'т', m: 'ь', ',': 'б', '.': 'ю',
}

/** Fixes a phrase typed in the wrong keyboard layout, e.g. "ltym" → "день". */
export function fixLayout(phrase: string): string {
  let result = ''
  for (const character of phrase.toLowerCase()) {
    result += layoutMap[character] ?? character
  }
  return result
}

export function normalizeKeyword(phrase: string): string {
  return fixLayout(phrase)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Intent classification ─────────────────────────────────────────────────────

const transactionalWords = new Set([
  'купить', 'куплю', 'заказать', 'заказ', 'цена', 'цены', 'прайс', 'стоимость',
  'сколько стоит', 'доставка', 'продажа', 'поставка', 'оптом', 'опт', 'счет',
])

const navigationalWords = new Set(['сайт', 'официальный', 'вход', 'логин'])

/**
 * A rule-based first pass. The model gets a classification refinement in later waves;
 * this is deterministic and honest about what it is — word lists, not AI.
 */
export function classifyIntent(phrase: string): KeywordIntent {
  const normalized = normalizeKeyword(phrase)
  const words = normalized.split(' ')

  if (words.some((word) => navigationalWords.has(word))) return 'navigational'
  if (words.some((word) => transactionalWords.has(word))) return 'transactional'

  // A commercial phrase names a product or a buying situation without an explicit
  // transaction verb; the conservative default is informational.
  return 'informational'
}

// ── Lexical clustering ────────────────────────────────────────────────────────

const stopwords = new Set([
  'для', 'как', 'что', 'чем', 'где', 'когда', 'или', 'без', 'при', 'от', 'до', 'по',
  'на', 'в', 'с', 'и', 'а', 'не', 'то', 'это', 'все', 'есть', 'нужно', 'надо',
])

export function tokenize(phrase: string): Set<string> {
  const words = normalizeKeyword(phrase).split(' ').filter((word) => word.length > 0)
  const tokens = new Set<string>()
  for (const word of words) {
    if (!stopwords.has(word)) tokens.add(word)
  }
  for (let index = 0; index < words.length - 1; index++) {
    const bigram = `${words[index]}_${words[index + 1]}`
    if (!stopwords.has(words[index] ?? '') && !stopwords.has(words[index + 1] ?? '')) {
      tokens.add(bigram)
    }
  }
  return tokens
}

export function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  return intersection / (left.size + right.size - intersection)
}

export interface ClusterInput {
  id: string
  phrase: string
  volume: number | null
  productId: string | null
  regionId: string | null
}

export interface LexicalCluster {
  members: ClusterInput[]
  /** The highest-volume member, or the first when volumes are absent. */
  pillar: ClusterInput
  productId: string | null
  regionId: string | null
}

export function clusterKeywords(keywords: ClusterInput[], threshold: number): LexicalCluster[] {
  const clusters: Array<{ members: ClusterInput[]; tokens: Set<string> }> = []

  for (const keyword of keywords) {
    const tokens = tokenize(keyword.phrase)
    let best: (typeof clusters)[number] | null = null
    let bestSimilarity = 0

    for (const cluster of clusters) {
      const similarity = jaccardSimilarity(tokens, cluster.tokens)
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        best = cluster
      }
    }

    if (best && bestSimilarity >= threshold) {
      best.members.push(keyword)
      for (const token of tokens) best.tokens.add(token)
    } else {
      clusters.push({ members: [keyword], tokens })
    }
  }

  return clusters.map((cluster) => {
    const pillar =
      cluster.members.reduce<ClusterInput | null>((champion, member) => {
        if (!champion) return member
        const championVolume = champion.volume ?? -1
        const memberVolume = member.volume ?? -1
        return memberVolume > championVolume ? member : champion
      }, null) ?? cluster.members[0]!

    const countBy = (key: 'productId' | 'regionId'): string | null => {
      const counts = new Map<string, number>()
      for (const member of cluster.members) {
        const value = member[key]
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      let best: string | null = null
      let bestCount = 0
      for (const [value, count] of counts) {
        if (count > bestCount) {
          best = value
          bestCount = count
        }
      }
      return best
    }

    return {
      members: cluster.members,
      pillar,
      productId: countBy('productId'),
      regionId: countBy('regionId'),
    }
  })
}
